import {createHash} from 'node:crypto';
import {posix} from 'node:path';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {ledgerColumnName,ledgerScalar} from './ledger-calculation.mjs';

const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const children=(el,name)=>Array.from(el.childNodes).filter(n=>n.nodeType===1&&n.localName===name);
const first=(el,name)=>children(el,name)[0];
function xml(bytes) {
  const doc=new DOMParser({errorHandler:{warning(){},error(){throw Error('WORKBOOK_XML_INVALID');},fatalError(){throw Error('WORKBOOK_XML_INVALID');}}}).parseFromString(strFromU8(bytes),'application/xml');
  if(doc.doctype)throw Error('WORKBOOK_XML_INVALID');return doc;
}
const output=doc=>strToU8(new XMLSerializer().serializeToString(doc));
const append=(parent,name,value)=>{const node=parent.ownerDocument.createElementNS(NS,name);if(value!==undefined)node.appendChild(parent.ownerDocument.createTextNode(String(value)));parent.appendChild(node);return node;};
const resolvePart=(parent,target)=>target.startsWith('/')?target.slice(1):posix.normalize(posix.join(posix.dirname(parent),target));
const relPart=part=>posix.join(posix.dirname(part),'_rels',posix.basename(part)+'.rels');
function linkedParts(files,part) {
  if(!files[relPart(part)])return new Map();
  return new Map(Array.from(xml(files[relPart(part)]).documentElement.childNodes).filter(n=>n.nodeType===1&&n.getAttribute('TargetMode')!=='External').map(n=>[n.getAttribute('Id'),resolvePart(part,n.getAttribute('Target'))]));
}
function anchors(files,sheetPath) {
  const links=linkedParts(files,sheetPath),sheet=xml(files[sheetPath]),found=[];
  for(const drawing of Array.from(sheet.getElementsByTagNameNS(NS,'drawing'))) {
    const path=links.get(drawing.getAttribute('r:id'));if(!path||!files[path])continue;
    const doc=xml(files[path]),media=linkedParts(files,path);
    for(const anchor of Array.from(doc.documentElement.childNodes).filter(n=>n.nodeType===1)) {
      const from=first(anchor,'from');if(!from)continue;
      const row=Number(first(from,'row')?.textContent)+1,column=Number(first(from,'col')?.textContent)+1;
      const blip=Array.from(anchor.getElementsByTagName('*')).find(n=>n.localName==='blip');
      const imagePath=blip&&media.get(blip.getAttribute('r:embed'));
      if(imagePath)found.push({doc,path,anchor,row,column,imagePath});
    }
  }
  return found;
}
export function readLedgerImages(book) {
  const files=unzipSync(Buffer.from(book.xlsxBase64,'base64')),root=xml(files['xl/workbook.xml']),links=linkedParts(files,'xl/workbook.xml');
  for(const sheet of book.sheets) {
    const entry=Array.from(root.getElementsByTagNameNS(NS,'sheet')).find(n=>n.getAttribute('name')===sheet.name);
    const path=entry&&links.get(entry.getAttribute('r:id'));sheet.images=[];
    if(!path)continue;
    for(const found of anchors(files,path)) {
      const ext=posix.extname(found.imagePath).toLowerCase(),mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp'}[ext];
      if(mime&&files[found.imagePath])sheet.images.push({row:found.row,column:found.column,url:`data:${mime};base64,${Buffer.from(files[found.imagePath]).toString('base64')}`});
    }
  }
}

// Patch the original archive rather than recreating a simplified workbook.
// All untouched parts (styles, images, hidden tabs, validations, names) survive.
export function updateLedgerXlsx(book,edits=[]) {
  const files=unzipSync(Buffer.from(book.xlsxBase64,'base64'));
  const root=xml(files['xl/workbook.xml']),rels=xml(files['xl/_rels/workbook.xml.rels']);
  const targets=new Map(Array.from(rels.documentElement.childNodes).filter(n=>n.nodeType===1).map(n=>[n.getAttribute('Id'),n.getAttribute('Target')]));
  const sheets=Array.from(root.getElementsByTagNameNS(NS,'sheet'));
  for(const sheet of book.sheets) {
    const entry=sheets.find(n=>n.getAttribute('name')===sheet.name);
    if(!entry)throw Error('WORKBOOK_SHEET_MISSING');
    const target=targets.get(entry.getAttribute('r:id'));if(!target)throw Error('WORKBOOK_SHEET_MISSING');
    const path=target.startsWith('/')?target.slice(1):resolvePart('xl/workbook.xml',target);
    const doc=xml(files[path]),data=first(doc.documentElement,'sheetData');
    if(!data)throw Error('WORKBOOK_XML_INVALID');
    const rows=new Map(children(data,'row').map(n=>[Number(n.getAttribute('r')),n]));
    function rowAt(number,templateRow) {
      if(rows.has(number))return rows.get(number);
      const row=doc.createElementNS(NS,'row'),template=rows.get(templateRow);
      if(template)for(const attr of Array.from(template.attributes))if(attr.name!=='r')row.setAttribute(attr.name,attr.value);
      row.setAttribute('r',String(number));
      data.insertBefore(row,children(data,'row').find(n=>Number(n.getAttribute('r'))>number)||null);rows.set(number,row);return row;
    }
    function cellAt(row,col,templateRow) {
      const tr=rowAt(row,templateRow),address=ledgerColumnName(col-1)+row;
      let cell=children(tr,'c').find(n=>n.getAttribute('r')===address);
      if(!cell) {
        cell=doc.createElementNS(NS,'c');cell.setAttribute('r',address);
        const template=rows.get(templateRow),source=template&&children(template,'c').find(n=>n.getAttribute('r')===ledgerColumnName(col-1)+templateRow);
        if(source?.hasAttribute('s'))cell.setAttribute('s',source.getAttribute('s'));
        const column=n=>n.getAttribute('r').match(/^[A-Z]+/)[0].split('').reduce((a,c)=>a*26+c.charCodeAt(0)-64,0);
        tr.insertBefore(cell,children(tr,'c').find(n=>column(n)>col)||null);
      }
      return cell;
    }
    const changed=edits.filter(e=>e.sheetId===sheet.id);
    const drawings=new Map();
    for(const found of anchors(files,path))if(changed.some(e=>e.row===found.row&&e.column===found.column)) {
      found.anchor.parentNode.removeChild(found.anchor);drawings.set(found.path,found.doc);
    }
    for(const [part,document] of drawings)files[part]=output(document);
    const addresses=new Map(changed.map(e=>[`${e.row}:${e.column}`,e]));
    for(let r=0;r<sheet.formulas.length;r++)for(let c=0;c<sheet.formulas[r].length;c++)if(sheet.formulas[r][c])addresses.set(`${r+1}:${c+1}`,addresses.get(`${r+1}:${c+1}`)||{row:r+1,column:c+1});
    for(const edit of addresses.values()) {
      const r=edit.row-1,c=edit.column-1,cell=cellAt(edit.row,edit.column,edit.templateRow);
      for(const node of [...children(cell,'v'),...children(cell,'is'),...children(cell,'f')])cell.removeChild(node);
      cell.removeAttribute('t');
      const formula=sheet.formulas[r]?.[c];
      if(formula) {
        append(cell,'f',formula.slice(1));const calculated=sheet.calculatedValues?.[r]?.[c];
        if(calculated) {
          if(calculated.type==='error')cell.setAttribute('t','e');
          else if(calculated.type==='string')cell.setAttribute('t','str');
          else if(calculated.type==='boolean')cell.setAttribute('t','b');
          append(cell,'v',calculated.type==='boolean'?(calculated.value?1:0):calculated.value??'');
        }
      } else {
        const raw=sheet.rawValues[r]?.[c] || {type:'text',value:''},value=ledgerScalar(raw);
        if(raw.type==='text') {cell.setAttribute('t','inlineStr');const t=append(append(cell,'is'),'t',value);t.setAttribute('xml:space','preserve');}
        else {if(raw.type==='boolean')cell.setAttribute('t','b');append(cell,'v',raw.type==='boolean'?(value?1:0):value);}
      }
    }
    const dimension=first(doc.documentElement,'dimension');
    if(dimension && changed.length)dimension.setAttribute('ref',`A1:${ledgerColumnName(sheet.columnCount-1)}${Math.max(sheet.rowCount,...rows.keys())}`);
    // Preserve existing comment parts and append receipt notes in that same format.
    const noteEdits=changed.filter(e=>sheet.notes?.[e.row-1]?.[e.column-1]);
    if(noteEdits.length) {
      const relPath=posix.join(posix.dirname(path),'_rels',posix.basename(path)+'.rels');
      let sheetRels=files[relPath]&&xml(files[relPath]);
      const commentRel=sheetRels && Array.from(sheetRels.documentElement.childNodes).find(n=>n.nodeType===1&&n.getAttribute('Type').endsWith('/comments'));
      let commentPath,comments;
      if(commentRel) {commentPath=resolvePart(path,commentRel.getAttribute('Target'));comments=xml(files[commentPath]);}
      else {
        commentPath=`xl/comments/aroundg-${sheet.id}.xml`;
        comments=xml(strToU8(`<comments xmlns="${NS}"><authors><author>Around G</author></authors><commentList/></comments>`));
        sheetRels ||= xml(strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'));
        const relation=sheetRels.createElementNS(sheetRels.documentElement.namespaceURI,'Relationship');
        relation.setAttribute('Id',`aroundgComments${sheet.id}`);relation.setAttribute('Type','http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments');relation.setAttribute('Target',posix.relative(posix.dirname(path),commentPath));sheetRels.documentElement.appendChild(relation);
        const types=xml(files['[Content_Types].xml']),type=types.createElementNS(types.documentElement.namespaceURI,'Override');type.setAttribute('PartName','/'+commentPath);type.setAttribute('ContentType','application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml');types.documentElement.appendChild(type);files['[Content_Types].xml']=output(types);
      }
      const list=first(comments.documentElement,'commentList');
      for(const e of noteEdits) {
        const ref=ledgerColumnName(e.column-1)+e.row;
        let comment=children(list,'comment').find(n=>n.getAttribute('ref')===ref);
        if(!comment){comment=append(list,'comment');comment.setAttribute('ref',ref);comment.setAttribute('authorId','0');}
        for(const child of children(comment,'text'))comment.removeChild(child);
        append(append(comment,'text'),'t',sheet.notes[e.row-1][e.column-1]);
      }
      files[commentPath]=output(comments);files[relPath]=output(sheetRels);
    }
    files[path]=output(doc);
  }
  let calc=first(root.documentElement,'calcPr');if(!calc)calc=append(root.documentElement,'calcPr');
  calc.setAttribute('fullCalcOnLoad','1');calc.setAttribute('forceFullCalc','1');calc.setAttribute('calcMode','auto');
  // A former calculation chain is stale after local edits.
  if(files['xl/calcChain.xml']) {
    delete files['xl/calcChain.xml'];
    for(const n of Array.from(rels.documentElement.childNodes))if(n.nodeType===1&&n.getAttribute('Type').endsWith('/calcChain'))rels.documentElement.removeChild(n);
    const types=xml(files['[Content_Types].xml']);
    for(const n of Array.from(types.documentElement.childNodes))if(n.nodeType===1&&n.getAttribute('PartName')==='/xl/calcChain.xml')types.documentElement.removeChild(n);
    files['[Content_Types].xml']=output(types);
  }
  files['xl/workbook.xml']=output(root);files['xl/_rels/workbook.xml.rels']=output(rels);
  const bytes=Buffer.from(zipSync(files,{level:6}));
  book.xlsxBase64=bytes.toString('base64');book.xlsxSha256=createHash('sha256').update(bytes).digest('hex');
  return book;
}
