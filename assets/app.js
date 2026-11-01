/* Pressmark - local edition sealing demo. No accounts, no uploads, no analytics. */
(function () {
  'use strict';
  var LS_KEY = 'pressmark.editions.v1';

  function loadEditions() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveEditions(list) {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  }
  function sha256(text) {
    var data = new TextEncoder().encode(text);
    return crypto.subtle.digest('SHA-256', data).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return ('0' + b.toString(16)).slice(-2);
      }).join('');
    });
  }
  function canonical(title, body) {
    // Normalised string that the seal digest covers.
    return 'PRESSMARK-EDITION\n' + title.replace(/\r\n/g, '\n').trim() + '\n---\n' + body.replace(/\r\n/g, '\n').trim() + '\n';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function getParam(name) {
    return new URLSearchParams(location.search).get(name);
  }

  /* ---------- write.html ---------- */
  var printBtn = document.getElementById('print-btn');
  if (printBtn) {
    var titleEl = document.getElementById('f-title');
    var bodyEl = document.getElementById('f-body');
    var wc = document.getElementById('wordcount');
    function updateWc() {
      var n = bodyEl.value.trim() ? bodyEl.value.trim().split(/\s+/).length : 0;
      wc.textContent = n + ' words';
    }
    bodyEl.addEventListener('input', updateWc); updateWc();

    var dlg = document.getElementById('confirm-dialog');
    var pending = null;
    printBtn.addEventListener('click', function () {
      var title = titleEl.value.trim(), body = bodyEl.value.trim();
      var err = document.getElementById('form-error');
      err.textContent = '';
      if (!title || !body) { err.textContent = 'Give your edition a title and a body before printing.'; return; }
      if (body.trim().split(/\s+/).length < 20) { err.textContent = 'An edition should say something - at least 20 words.'; return; }
      var editions = loadEditions();
      var num = editions.length ? Math.max.apply(null, editions.map(function (e) { return e.number; })) + 1 : 1;
      var date = new Date().toISOString();
      sha256(canonical(title, body)).then(function (hash) {
        pending = { number: num, title: title, body: body, date: date, seal: hash, errata: [] };
        document.getElementById('c-num').textContent = 'No. ' + num;
        document.getElementById('c-date').textContent = new Date(date).toLocaleString();
        document.getElementById('c-hash').textContent = hash;
        if (typeof dlg.showModal === 'function') dlg.showModal(); else finalize();
      });
    });
    document.getElementById('confirm-print').addEventListener('click', finalize);
    function finalize() {
      if (!pending) return;
      var editions = loadEditions();
      editions.push(pending);
      saveEditions(editions);
      location.href = 'edition.html?id=' + encodeURIComponent(pending.seal) + '&fresh=1';
    }
  }

  /* ---------- library.html ---------- */
  var libList = document.getElementById('library-list');
  if (libList) {
    var editions = loadEditions().slice().sort(function (a, b) { return b.number - a.number; });
    if (!editions.length) {
      libList.innerHTML = '<div class="empty"><p>No editions yet. Your press is idle.</p></div>';
    } else {
      libList.innerHTML = editions.map(function (e) {
        return '<div class="card"><div class="meta">EDITION No. ' + e.number + ' · ' +
          new Date(e.date).toLocaleString() + '</div><h3><a href="edition.html?id=' +
          encodeURIComponent(e.seal) + '">' + esc(e.title) + '</a></h3><div class="meta">seal ' +
          e.seal.slice(0, 16) + '… · ' + (e.errata ? e.errata.length : 0) + ' ' + ((e.errata && e.errata.length === 1) ? 'erratum' : 'errata') + '</div></div>';
      }).join('');
    }
    var exportBtn = document.getElementById('export-btn');
    if (exportBtn) exportBtn.addEventListener('click', function () {
      var blob = new Blob([JSON.stringify(loadEditions(), null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'pressmark-editions.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });
    var importBtn = document.getElementById('import-btn');
    var importFile = document.getElementById('import-file');
    var importResult = document.getElementById('import-result');
    if (importBtn && importFile) importBtn.addEventListener('click', function () { importFile.click(); });
    if (importFile) importFile.addEventListener('change', function () {
      var f = importFile.files && importFile.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        importResult.textContent = '';
        var data;
        try { data = JSON.parse(reader.result); }
        catch (err) { importResult.textContent = 'That file is not valid JSON. Nothing was imported.'; return; }
        var items = Array.isArray(data) ? data : [data];
        var existing = loadEditions();
        var maxNum = existing.length ? Math.max.apply(null, existing.map(function (x) { return x.number; })) : 0;
        var added = 0, dup = 0, bad = 0, mismatched = 0;
        var chain = Promise.resolve();
        items.forEach(function (it) {
          chain = chain.then(function () {
            if (!it || typeof it.title !== 'string' || typeof it.body !== 'string' ||
                typeof it.seal !== 'string' || !/^[0-9a-f]{64}$/.test(it.seal) || !it.date) { bad++; return; }
            return sha256(canonical(it.title, it.body)).then(function (h) {
              if (h !== it.seal) { mismatched++; return; }
              if (existing.some(function (x) { return x.seal === it.seal; })) { dup++; return; }
              var errata = Array.isArray(it.errata) ? it.errata.filter(function (x) {
                return x && typeof x.text === 'string' && x.date;
              }) : [];
              existing.push({ number: ++maxNum, title: it.title, body: it.body, date: it.date, seal: it.seal, errata: errata });
              added++;
            });
          });
        });
        chain.then(function () {
          saveEditions(existing);
          var parts = [];
          if (added) parts.push(added + ' edition' + (added === 1 ? '' : 's') + ' imported');
          if (dup) parts.push(dup + ' already in this library');
          if (mismatched) parts.push(mismatched + ' refused: the words do not match their seal');
          if (bad) parts.push(bad + ' skipped: not a Pressmark edition file');
          importResult.textContent = (parts.join(' \u00b7 ') || 'Nothing importable found in that file.') +
            (added ? '. A seal match means the words match what was sealed in the file - it says nothing about who wrote them.' : '');
          if (added) setTimeout(function () { location.reload(); }, 1800);
        });
      };
      reader.readAsText(f);
      importFile.value = '';
    });
  }

  /* ---------- edition.html ---------- */
  var edRoot = document.getElementById('edition-root');
  if (edRoot) {
    var SAMPLE = {
      number: 0, sample: true,
      title: 'Why this press exists (a demonstration edition)',
      body: 'This is a sealed demonstration edition.\n\nToday, much of what you read online can change after you read it - edited silently, updated, replaced. And when content is infinite, finishing anything becomes rare.\n\nPressmark tests the opposite habit: write something, then print it. A printed edition gets a number, a date and a seal - a fingerprint of its exact words. After that, corrections do not rewrite the page; they appear below it, as visible errata.\n\nWhat this demo is: a browser-local experiment. Editions you print are stored only in this browser, on this device. The seal is a digest you can use to check whether a copy of an edition still matches the original words - nothing more. It does not prove who wrote it, when it was really written, and it cannot stop anyone from deleting or replacing a local copy. Finality here is a habit, not a guarantee.\n\nWhat this demo is not: a publishing service, a blockchain, or a promise. No accounts, no uploads, no tracking.',
      date: '2026-10-31T20:00:00.000Z', seal: '', errata: [
        { date: '2026-10-31T20:30:00.000Z', text: 'An earlier draft said "the seal proves the words are true". It proves only that a copy matches - truth is still the author\'s job.' }
      ]
    };
    sha256(canonical(SAMPLE.title, SAMPLE.body)).then(function (h) { SAMPLE.seal = h; render(); });

    function findEdition() {
      var id = getParam('id');
      if (id === 'sample') return SAMPLE;
      return loadEditions().filter(function (e) { return e.seal === id; })[0] || null;
    }
    function render() {
      var e = findEdition();
      if (!e) {
        edRoot.innerHTML = '<div class="empty"><p>This edition is not in this browser. Editions are stored locally, so a link only works where the edition was printed.</p><p><a href="library.html">Open the library</a></p></div>';
        return;
      }
      var errataHtml = (e.errata || []).map(function (x) {
        return '<div class="erratum"><div class="when">ERRATUM · ' + new Date(x.date).toLocaleString() + '</div>' + esc(x.text) + '</div>';
      }).join('');
      edRoot.innerHTML =
        '<article class="edition"><div class="meta" style="font-size:.82rem;color:#6d6558;letter-spacing:.05em">' +
        (e.sample ? 'DEMONSTRATION EDITION · ' : 'EDITION No. ' + e.number + ' · ') + new Date(e.date).toLocaleString() +
        ' <span class="badge-sealed">sealed</span></div>' +
        '<h3 style="font-size:1.6rem;margin:10px 0 16px">' + esc(e.title) + '</h3>' +
        '<div class="body">' + esc(e.body) + '</div>' +
        '<div class="sealblock">SEAL (SHA-256 of the normalised text)<br><code>' + e.seal + '</code><br>' +
        '<span id="verify-line" style="font-size:.82rem;color:#6d6558"></span></div></article>' +
        '<h2 class="section">Errata</h2>' +
        '<p style="color:#6d6558;font-size:.95rem">The edition above is finished. Corrections are added here, visibly, with their own dates.</p>' +
        '<div id="errata-list">' + (errataHtml || '<p style="color:#6d6558">No errata yet.</p>') + '</div>' +
        (e.sample ? '' :
        '<label class="f" for="err-text">Add an erratum</label>' +
        '<textarea id="err-text" style="min-height:90px" placeholder="What did the edition get wrong, and when did you learn it?"></textarea>' +
        '<div class="row"><button class="btn secondary" id="add-erratum">Add erratum</button>' +
        '<button class="btn secondary" id="verify-seal">Verify this copy against its seal</button>' +
        '<button class="btn secondary" id="export-edition">Export this edition</button></div>');
      var vb = document.getElementById('verify-seal');
      if (vb) vb.addEventListener('click', function () {
        sha256(canonical(e.title, e.body)).then(function (h) {
          document.getElementById('verify-line').textContent = h === e.seal
            ? 'Checked: this copy matches its seal.'
            : 'Warning: this copy does NOT match its seal.';
        });
      });
      var exb = document.getElementById('export-edition');
      if (exb) exb.addEventListener('click', function () {
        var blob = new Blob([JSON.stringify(e, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'pressmark-edition-' + e.seal.slice(0, 8) + '.json';
        a.click();
        URL.revokeObjectURL(a.href);
      });
      var ab = document.getElementById('add-erratum');
      if (ab) ab.addEventListener('click', function () {
        var t = document.getElementById('err-text').value.trim();
        if (!t) return;
        var editions = loadEditions();
        for (var i = 0; i < editions.length; i++) if (editions[i].seal === e.seal) {
          editions[i].errata = editions[i].errata || [];
          editions[i].errata.push({ date: new Date().toISOString(), text: t });
        }
        saveEditions(editions); render();
      });
    }
  }
})();
