// - run: npx esbuild src/webview/canvas/nodes/knowledgeHtml.ts --bundle --format=esm --outfile=tests/.build/knowledgeHtml.mjs && node --test tests/knowledge-html.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { sanitizeHtmlAttrs } from './.build/knowledgeHtml.mjs';

test('an inline event handler is removed and the rest of the tag stays', () => {
  assert.equal(sanitizeHtmlAttrs('<div class="a" onclick="steal()">text</div>'), '<div class="a">text</div>');
});

test('the handler name is matched in any case and with any quoting', () => {
  assert.equal(sanitizeHtmlAttrs(`<img ONERROR='go()' src="a.png">`), '<img src="a.png">');
  assert.equal(sanitizeHtmlAttrs('<img onload=go() src="a.png">'), '<img src="a.png">');
});

test('a javascript: href becomes #, in its entity and upper-case spellings too', () => {
  assert.equal(sanitizeHtmlAttrs('<a href="javascript:alert(1)">y</a>'), '<a href="#">y</a>');
  assert.equal(sanitizeHtmlAttrs('<a href="java&#115;cript:alert(1)">y</a>'), '<a href="#">y</a>');
  assert.equal(sanitizeHtmlAttrs('<a href="JAVASCRIPT:alert(1)">y</a>'), '<a href="#">y</a>');
});

test('an ordinary link and image are left alone', () => {
  const html = '<p><a href="https://example.com/a?b=1&c=2">ok</a> <img src="./img.png" alt="a photo"></p>';
  assert.equal(sanitizeHtmlAttrs(html), html);
});

test('text between tags is left alone, even when it reads like an attribute', () => {
  for (const html of [
    '<p>the onboarding=fun plan</p>',
    '<p>run once=true</p>',
    '<pre><code>&lt;img onerror=alert(1)&gt;</code></pre>',
    '<a title="see onload=x later">t</a>',
    '<a title="one=two">t</a>',
  ]) assert.equal(sanitizeHtmlAttrs(html), html);
});

test('a handler written inside a tag is still removed', () => {
  assert.equal(sanitizeHtmlAttrs('<img onerror=alert(1)>'), '<img>');
  assert.equal(sanitizeHtmlAttrs('<p>text</p><img onerror=alert(1)><p>more</p>'), '<p>text</p><img><p>more</p>');
});

test('srcdoc is removed outright', () => {
  assert.equal(sanitizeHtmlAttrs('<iframe srcdoc="&lt;script&gt;go()&lt;/script&gt;" width="10"></iframe>'), '<iframe width="10"></iframe>');
});

test('action, formaction and data are judged like href', () => {
  assert.equal(sanitizeHtmlAttrs('<form action="javascript:go()">f</form>'), '<form action="#">f</form>');
  assert.equal(sanitizeHtmlAttrs('<button formaction="javascript:go()">b</button>'), '<button formaction="#">b</button>');
  assert.equal(sanitizeHtmlAttrs('<object data="javascript:go()"></object>'), '<object data="#"></object>');
});

test('a data: url that is a document is blocked in src and data; other data: urls stay', () => {
  assert.equal(sanitizeHtmlAttrs('<iframe src="data:text/html;base64,PHNjcmlwdD4="></iframe>'), '<iframe src="#"></iframe>');
  assert.equal(sanitizeHtmlAttrs('<object data="data:text/html,<b>x</b>"></object>'), '<object data="#"></object>');
  const img = '<img src="data:image/png;base64,AAA=" alt="a">';
  assert.equal(sanitizeHtmlAttrs(img), img);
});

test('javascript: spelled with named entities is caught too', () => {
  assert.equal(sanitizeHtmlAttrs('<a href="javascript&colon;alert(1)">y</a>'), '<a href="#">y</a>');
  assert.equal(sanitizeHtmlAttrs('<a href="java&Tab;script:alert(1)">y</a>'), '<a href="#">y</a>');
  assert.equal(sanitizeHtmlAttrs('<a href="java&NewLine;script:alert(1)">y</a>'), '<a href="#">y</a>');
});

test('the entities an ordinary url carries do not make it suspect', () => {
  const html = '<a href="https://example.com/?a=1&amp;b=2&lpar;x&rpar;">ok</a>';
  assert.equal(sanitizeHtmlAttrs(html), html);
});
