import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [patch, style] = await Promise.all([
  readFile(new URL('../scripts/patch-simple-header-traffic.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../src/style.css', import.meta.url), 'utf8'),
]);

test('좁은 창에서 상단 상태 카드와 버튼 글자를 자르지 않는다', () => {
  assert.match(patch, /SIMPLE_HEADER_NO_CLIP_V2/);
  assert.match(patch, /overflow:visible!important/);
  assert.match(patch, /min-width:max-content!important/);
  assert.match(patch, /@media\(max-width:1050px\)/);
  assert.match(patch, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/);
  assert.match(patch, /white-space:normal!important/);
});

test('신호등 3색과 작동 시퀀스는 그대로 유지한다', () => {
  const source = `${style}\n${patch}`;
  assert.match(source, /window-dots i:nth-child\(1\).*#ef4444/);
  assert.match(source, /window-dots i:nth-child\(2\).*#facc15/);
  assert.match(source, /window-dots i:nth-child\(3\).*#22c55e/);
  assert.match(source, /window-dots\.sourcing i:nth-child\(1\).*animation-delay:0s/);
  assert.match(source, /window-dots\.sourcing i:nth-child\(2\).*animation-delay:\.18s/);
  assert.match(source, /window-dots\.sourcing i:nth-child\(3\).*animation-delay:\.36s/);
});
