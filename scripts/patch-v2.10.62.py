from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STYLE = ROOT / "src" / "style.css"
PACKAGE = ROOT / "package.json"
LOCK = ROOT / "package-lock.json"
TEST = ROOT / "tests" / "responsive-text-v2.10.62.test.mjs"

marker = "/* v2.10.62 responsive text and overflow safeguards */"
style = STYLE.read_text(encoding="utf-8")
if marker in style:
    raise RuntimeError("v2.10.62 CSS patch already applied")

style += r'''

/* v2.10.62 responsive text and overflow safeguards */
:root{
  font-family:"Segoe UI","Malgun Gothic","Apple SD Gothic Neo",Arial,sans-serif;
  text-rendering:optimizeLegibility;
}
button,input,select,textarea{font-family:inherit}

/* Long live-status messages must grow vertically instead of being clipped. */
.brand-activity{
  align-items:flex-start;
  min-height:62px;
  overflow:visible;
  padding:12px 14px;
}
.brand-activity-copy{
  flex:1 1 auto;
  width:100%;
  overflow:visible;
}
.brand-activity-copy strong,
.brand-activity-copy small,
.brand-activity-copy small span{
  min-width:0;
  max-width:none;
  white-space:normal;
  overflow:visible;
  text-overflow:clip;
  overflow-wrap:anywhere;
  word-break:keep-all;
  line-height:1.45;
}
.brand-activity-copy strong{display:block;font-size:13px}
.brand-activity-copy small{display:flex;flex-wrap:wrap;gap:2px 6px;font-size:11px}

/* Active jobs use flexible columns and wrap every user-visible value. */
.brand-export-job{display:block;overflow:visible;padding:12px 14px}
.brand-export-job-heading{margin-bottom:8px}
.brand-export-job-row{
  grid-template-columns:minmax(96px,.75fr) minmax(150px,1fr) minmax(0,2.2fr);
  align-items:start;
  min-height:48px;
  padding:9px 10px;
}
.brand-export-job-row strong,
.brand-export-job-row code,
.brand-export-job-state{
  min-width:0;
  max-width:none;
  white-space:normal;
  overflow:visible;
  text-overflow:clip;
  overflow-wrap:anywhere;
  word-break:keep-all;
  line-height:1.45;
}
.brand-export-job-state{
  justify-self:stretch;
  border-radius:12px;
  padding:6px 10px;
  text-align:left;
}

/* Batch summary and rows remain readable at Windows display scaling. */
.brand-batch-progress-head{flex-wrap:wrap;gap:6px 12px}
.brand-batch-progress-head strong,
.brand-batch-progress-head span{
  min-width:0;
  white-space:normal;
  overflow-wrap:anywhere;
  word-break:keep-all;
  line-height:1.4;
}
.brand-batch-row{
  grid-template-columns:minmax(96px,.75fr) minmax(150px,1fr) minmax(0,2.2fr);
  align-items:start;
  min-height:48px;
}
.brand-batch-row strong,
.brand-batch-row code,
.brand-batch-row span{
  min-width:0;
  max-width:none;
  white-space:normal;
  overflow:visible;
  text-overflow:clip;
  overflow-wrap:anywhere;
  word-break:keep-all;
  line-height:1.45;
}
.brand-batch-row span{text-align:left}

/* Completed rows also expand when a historic label or timestamp is long. */
.brand-export-completed-row{
  grid-template-columns:minmax(110px,.85fr) minmax(170px,1.25fr) minmax(145px,1fr) minmax(82px,auto);
  align-items:start;
}
.brand-export-completed-row strong,
.brand-export-completed-row code,
.brand-export-completed-row time,
.brand-export-completed-row>span{
  min-width:0;
  white-space:normal;
  overflow-wrap:anywhere;
  word-break:keep-all;
  line-height:1.45;
}
.brand-export-completed-row>span{justify-self:end;text-align:center}

/* Inline status text below the panels must never be one-line clipped. */
.status,
#brand-status{
  height:auto;
  min-height:20px;
  white-space:normal;
  overflow:visible;
  text-overflow:clip;
  overflow-wrap:anywhere;
  word-break:keep-all;
  line-height:1.55;
}

/* Brand cards show up to two lines instead of ellipsis-only labels. */
.brand-card{
  min-width:0;
  height:auto;
  min-height:58px;
  align-items:center;
}
.brand-card span{min-width:0;overflow:visible}
.brand-card strong{
  display:-webkit-box;
  -webkit-box-orient:vertical;
  -webkit-line-clamp:2;
  max-width:100%;
  white-space:normal;
  overflow:hidden;
  text-overflow:clip;
  overflow-wrap:anywhere;
  word-break:keep-all;
  line-height:1.25;
}
.brand-card.download-complete{grid-template-columns:30px minmax(0,1fr) auto}

@media(max-width:1180px){
  .brand-export-job-row,
  .brand-batch-row{
    grid-template-columns:minmax(90px,.7fr) minmax(138px,.95fr) minmax(0,2fr);
  }
  .brand-export-completed-row{
    grid-template-columns:minmax(100px,.8fr) minmax(155px,1.15fr) minmax(135px,1fr) minmax(78px,auto);
  }
}
@media(max-width:900px){
  .brand-export-job-row,
  .brand-batch-row,
  .brand-export-completed-row{
    grid-template-columns:1fr;
    gap:6px;
  }
  .brand-export-job-state,
  .brand-export-completed-row>span{
    justify-self:start;
    width:100%;
  }
  .brand-batch-progress-head{align-items:flex-start;flex-direction:column}
}
'''
STYLE.write_text(style, encoding="utf-8")

for path in [PACKAGE, LOCK]:
    source = path.read_text(encoding="utf-8")
    if '"version": "2.10.61"' not in source:
        raise RuntimeError(f"expected 2.10.61 version in {path}")
    path.write_text(source.replace('"version": "2.10.61"', '"version": "2.10.62"'), encoding="utf-8")

for path in (ROOT / "tests").glob("*.test.mjs"):
    source = path.read_text(encoding="utf-8")
    if "2.10.61" in source:
        path.write_text(source.replace("2.10.61", "2.10.62"), encoding="utf-8")

TEST.write_text(r'''import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [style, packageSource, lockSource] = await Promise.all([
  readFile(new URL("../src/style.css", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);

test("live status and job rows wrap instead of clipping", () => {
  assert.match(style, /v2\.10\.62 responsive text and overflow safeguards/);
  assert.match(style, /\.brand-activity-copy strong,[\s\S]*?white-space:normal/);
  assert.match(style, /\.brand-export-job-row\{[\s\S]*?grid-template-columns:minmax\(96px/);
  assert.match(style, /\.brand-export-job-state\{[\s\S]*?border-radius:12px/);
  assert.match(style, /#brand-status\{[\s\S]*?overflow-wrap:anywhere/);
});

test("batch, completed and brand-card labels remain readable", () => {
  assert.match(style, /\.brand-batch-row strong,[\s\S]*?word-break:keep-all/);
  assert.match(style, /\.brand-export-completed-row\{[\s\S]*?align-items:start/);
  assert.match(style, /\.brand-card strong\{[\s\S]*?-webkit-line-clamp:2/);
  assert.match(style, /@media\(max-width:900px\)[\s\S]*?grid-template-columns:1fr/);
});

test("release metadata is 2.10.62", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.62");
  assert.equal(JSON.parse(lockSource).version, "2.10.62");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.62");
});
''', encoding="utf-8")

print("Applied v2.10.62 responsive typography and overflow safeguards")
