export function serveClipFixture(request, response) {
  if (!request.url?.startsWith("/clip-")) { return false; }
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": "clipSession=retained;path=/" });
  const paragraph = "An article can become a useful note while keeping its source and the words that matter. Walking along the river in autumn gives us time to notice the light, listen to the birds and remember a good conversation. 中文 and 😀 remain readable. ";
  if (request.url.startsWith("/clip-selection")) {
    if (request.url === "/clip-selection-frame") { response.end('<!doctype html><p id="frame-text">Frame selection stays separate.</p>'); return true; }
    const long = request.url === "/clip-selection-long";
    response.end(`<!doctype html><html lang="en"><head><title>Selection clipping</title></head><body style="font:18px sans-serif;padding:20px"><article><h1>Selection clipping</h1><p style="white-space:nowrap">Before selection <span id="selection-target">Picked 中文 😀 | **literal**</span> After selection</p><section id="selection-multi"><p>First selected paragraph <strong>bold words</strong>.</p><p>Literal &lt;img src=x onerror=bad()&gt; ![[Secret]] $math$ %%comment%%.</p></section><p id="selection-short">字</p><p id="selection-blank" style="white-space:pre">   </p>${long ? '<p id="selection-long">' + "x".repeat(200_001) + '</p>' : ''}<p>${paragraph.repeat(4)}</p></article><label>Original input <input id="selection-input" value="Control value stays separate"></label><textarea id="selection-textarea">Textarea value stays separate</textarea><iframe title="Selection frame" src="/clip-selection-frame"></iframe><p>Outside selection stays outside.</p><script>window.fixtureSelection=window.getSelection.bind(window);window.getSelection=function(){throw Error('page-world selection spoof')};Document.prototype.cloneNode=function(){throw Error('page-world clone spoof')};</script></body></html>`);
    return true;
  }
  if (request.url.startsWith("/clip-table-")) {
    const tables = {
      nested: '<table><tr><th>Outer heading</th></tr><tr><td>Outer value<table><tr><th>Inner heading</th></tr><tr><td>Inner value</td></tr></table></td></tr></table>',
      overlap: '<table><tr><th>A</th><th rowspan="2">B</th></tr><tr><td colspan="2">Collision</td></tr></table>',
      wide: '<table><tr><th colspan="101">Expanded width</th></tr><tr><td>Value</td></tr></table>',
      tall: '<table><tr><th rowspan="1001">Expanded height</th><th>Value</th></tr></table>',
      amplified: `<table><tr><th colspan="100">${"Bounded content. ".repeat(1500)}</th></tr><tr><td>Value</td></tr></table>`,
    };
    const kind = request.url.slice("/clip-table-".length);
    const content = tables[kind] ?? `<table><caption>Shipping plan 中文 😀</caption><tfoot><tr><th>Total</th><td colspan="2">30</td></tr></tfoot><thead><tr><th rowspan="2">Region</th><th colspan="2">Forecast</th></tr><tr><th>Spring</th><th>Autumn</th></tr></thead><tbody><tr><th rowspan="2">North</th><td><strong>12</strong></td><td><a href="/table-notes?q=one#part">Notes</a></td></tr><tr><td><code>a|b</code></td><td>Literal | &amp; ![[Secret]]</td></tr></tbody><tbody><tr><th rowspan="0">South</th><td colspan="2"><em>steady</em></td></tr><tr><td>5</td><td>6</td></tr></tbody></table><p>Implied rows stay within their group.</p><table><caption>Implied rows</caption><tbody><tr><th rowspan="0">All</th><th rowspan="3">Tall</th></tr></tbody><tfoot><tr><td colspan="2">Footer</td></tr></tfoot></table><p>HTML span defaults.</p><table><tr><th colspan="0">Default</th><th colspan="2tail">Pair</th></tr><tr><td rowspan="invalid">One</td><td colspan="-2">Two</td><td>Three</td></tr></table><p colspan="99" rowspan="8">Span attributes belong only to table cells.</p>`;
    response.end(`<!doctype html><html lang="en"><head><title>Merged table clipping</title></head><body><nav>Do not clip navigation</nav><article><h1>Merged table clipping</h1><p>${paragraph.repeat(4)}</p>${content}<p>${paragraph.repeat(4)}</p></article><label>Original input <input id="table-original"></label><script>window.Readability=function(){throw Error('page-world spoof')};Document.prototype.cloneNode=function(){throw Error('page-world clone override')};</script></body></html>`);
    return true;
  }
  if (request.url.startsWith("/clip-list-")) {
    const lists = {
      reversed: '<ol reversed start="3"><li>Reverse three</li><li>Reverse two</li></ol>',
      negative: '<ol start="-2"><li>Negative two</li><li>Negative one</li></ol>',
      reset: '<ol start="7"><li>Reset seven</li><li value="20">Reset twenty</li></ol>',
      oversized: '<ol start="1000000000"><li>Ten-digit start</li><li>Another step</li></ol>',
    };
    const kind = request.url.slice("/clip-list-".length);
    const content = lists[kind] ?? `<ol start="7" onmouseover="window.badList=true"><li>List seven<ol start="21"><li>Nested twenty-one</li><li>Nested twenty-two</li></ol></li><li value="8">List eight</li></ol><ol start="12"><li>Separate twelve</li><li>Separate thirteen</li></ol><p>Zero-based sequence.</p><ol start="0"><li>Zero step</li><li>One step</li></ol><p>First item overrides the list start.</p><ol start="3"><li value="15">Override fifteen</li><li>Override sixteen</li></ol><p>Invalid attributes retain HTML defaults.</p><ol start="bogus"><li>Default one</li><li>Default two</li></ol><p>The Markdown marker boundary.</p><ol start="999999999"><li>Boundary first</li><li>Boundary next</li></ol><p start="99" reversed value="42">Numbering attributes belong only to lists.</p>`;
    response.end(`<!doctype html><html lang="en"><head><title>Ordered list clipping</title></head><body><nav>Do not clip navigation</nav><article><h1>Ordered list clipping</h1><p>${paragraph.repeat(4)}</p>${content}<p>${paragraph.repeat(4)}</p></article><label>Original input <input id="list-original"></label><script>window.Readability=function(){throw Error('page-world spoof')};Document.prototype.cloneNode=function(){throw Error('page-world clone override')};</script></body></html>`);
    return true;
  }
  const wide = request.url === "/clip-wide";
  response.end(`<!doctype html><html lang="en"><head><title>A clipping story</title><meta name="author" content="Clip Fixture Author"></head><body><nav>Do not clip this menu</nav><article><h1>A clipping story</h1><p>${paragraph.repeat(4)}</p><h2>Remember this heading</h2><p>Text has <strong>bold</strong> and <em>emphasis</em>, plus <code>inline\x60code</code>. Literal ![[Secret]] and &lt;img src=x onerror=alert(1)&gt; remain text.</p><ul><li>First item<ul><li>Nested item</li></ul></li><li>Second item</li></ul><ol><li>First ordered</li><li>Second ordered</li></ol><blockquote>A thoughtful quotation.</blockquote><pre><code>\x60\x60\x60mermaid\ngraph TD\n\x60\x60\x60\n&lt;script&gt;doNotRun()&lt;/script&gt;\n\nlast line</code></pre><p>${paragraph.repeat(4)}</p><p><a href="/reader-next?q=one%20two#part">A relative link</a> and <a href="javascript:alert(1)">Unsafe link</a>.</p><figure><img src="/reader-image" alt="A calm riverside"><figcaption>A caption stays readable.</figcaption></figure><table><tr>${wide ? "<th>Column</th>".repeat(101) : "<th>Season</th><th>Light</th>"}</tr><tr><td>Autumn</td><td>Soft</td></tr></table><form><input value="private form text"></form></article><input id="clip-original"><footer>Do not clip this footer</footer><script>window.Readability=function(){throw new Error('spoofed')};Document.prototype.cloneNode=function(){throw new Error('spoofed clone')};</script></body></html>`);
  return true;
}
