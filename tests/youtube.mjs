// - run: npx esbuild src/shared/youtube.ts --bundle --format=esm --outfile=tests/.build/youtube.mjs && node --test tests/youtube.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { youtubeId, youtubeThumbnail } from './.build/youtube.mjs';

test('youtubeId reads the video id from every YouTube link form', () => {
  assert.equal(youtubeId('https://www.youtube.com/watch?v=OQ4vrshu31Y'), 'OQ4vrshu31Y');
  assert.equal(youtubeId('https://youtube.com/watch?list=PL1&v=OQ4vrshu31Y&t=42s'), 'OQ4vrshu31Y');
  assert.equal(youtubeId('https://m.youtube.com/watch?v=OQ4vrshu31Y'), 'OQ4vrshu31Y');
  assert.equal(youtubeId('https://youtu.be/OQ4vrshu31Y?si=abc&t=10'), 'OQ4vrshu31Y');
  assert.equal(youtubeId('https://www.youtube.com/shorts/OQ4vrshu31Y'), 'OQ4vrshu31Y');
  assert.equal(youtubeId('https://www.youtube.com/embed/OQ4vrshu31Y?rel=0'), 'OQ4vrshu31Y');
  assert.equal(youtubeId('https://www.youtube-nocookie.com/embed/OQ4vrshu31Y'), 'OQ4vrshu31Y');
  assert.equal(youtubeId('https://www.youtube.com/live/OQ4vrshu31Y'), 'OQ4vrshu31Y');
});

test('youtubeId gives null for anything that is not a single video', () => {
  assert.equal(youtubeId('https://www.youtube.com/'), null);
  assert.equal(youtubeId('https://www.youtube.com/playlist?list=PL1'), null);
  assert.equal(youtubeId('https://www.youtube.com/@channel'), null);
  assert.equal(youtubeId('https://notyoutube.com/watch?v=OQ4vrshu31Y'), null);
  assert.equal(youtubeId('https://www.youtube.com/watch?v=<script>'), null);
  assert.equal(youtubeId('not a url'), null);
});

test('youtubeThumbnail points at the picture YouTube serves for the id', () => {
  assert.equal(youtubeThumbnail('OQ4vrshu31Y'), 'https://i.ytimg.com/vi/OQ4vrshu31Y/hqdefault.jpg');
});
