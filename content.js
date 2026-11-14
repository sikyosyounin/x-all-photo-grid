(() => {
  'use strict';
  const CHANNEL = 'x-all-photo-grid-v1';
  const posts = new Map();
  const rendered = new Set();
  const attempted = new Map();
  let scheduled = false;
  const photoPattern = /^\/(?:[A-Za-z0-9_]+|i\/web)\/status\/(\d+)\/photo\/(\d+)\/?$/;
  function photoLink(a) {
    try { return new URL(a.href, location.href).pathname.match(photoPattern); } catch { return null; }
  }
  function commonParent(elements) {
    let parent = elements[0]?.parentElement;
    while (parent && !elements.every(e => parent.contains(e))) parent = parent.parentElement;
    return parent;
  }
  function mediaRoot(inner, article, id) {
    // Replace the entire media frame, including fixed-height/aspect-ratio wrappers.
    // Inserting inside that frame clips later rows even when all thumbnails exist.
    let root = inner;
    for (let level = 0; level < 12; level++) {
      const parent = root.parentElement;
      if (!parent || parent === article) break;
      if (parent.querySelector('[data-testid="tweetText"], [data-testid="User-Name"], time, [data-testid="reply"], [data-testid="like"], [data-testid="retweet"], video, [data-testid="card.wrapper"]')) break;
      const otherPhotos = [...parent.querySelectorAll('a[href*="/status/"][href*="/photo/"]')].some(a => {
        const match = photoLink(a);
        return match && match[1] !== id;
      });
      if (otherPhotos) break;
      root = parent;
    }
    return root;
  }
  function restore(record) {
    record.grid.remove();
    record.original.removeAttribute('data-xapg-hidden');
    rendered.delete(record);
  }
  function update() {
    scheduled = false;
    for (const record of [...rendered]) {
      if (!record.grid.isConnected || !record.original.isConnected || !record.original.querySelector(`a[href*="/status/${record.id}/photo/"]`)) restore(record);
    }
    const groups = new Map();
    const missing = new Map();
    for (const a of document.querySelectorAll('a[href*="/status/"][href*="/photo/"]')) {
      if (a.closest('.xapg-grid, [data-xapg-hidden], [role="dialog"]')) continue;
      const match = photoLink(a);
      if (!match) continue;
      const article = a.closest('article');
      // Limit to X's standard post renderer; other page implementations are left untouched.
      if (!article) continue;
      if (!posts.has(match[1])) { missing.set(match[1], (missing.get(match[1]) || 0) + 1); continue; }
      let byId = groups.get(article);
      if (!byId) groups.set(article, byId = new Map());
      if (!byId.has(match[1])) byId.set(match[1], []);
      byId.get(match[1]).push(a);
    }
    const now = Date.now();
    const ids = [...missing].filter(([id, count]) => count >= 6 && now - (attempted.get(id) || 0) > 5000).map(([id]) => id).slice(0, 8);
    if (ids.length) {
      ids.forEach(id => attempted.set(id, now));
      while (attempted.size > 200) attempted.delete(attempted.keys().next().value);
      window.postMessage({channel: CHANNEL, kind: 'request', ids}, location.origin);
    }
    for (const [article, byId] of groups) for (const [id, links] of byId) {
      if (links.length < 2) continue;
      const inner = commonParent(links);
      if (!inner || inner === article || inner.contains(article.querySelector('[data-testid="tweetText"]'))) continue;
      const original = mediaRoot(inner, article, id);
      if ([...rendered].some(r => r.id === id && r.original === original)) continue;
      const post = posts.get(id);
      const grid = document.createElement('div');
      grid.className = 'xapg-grid';
      grid.setAttribute('role', 'group');
      grid.setAttribute('aria-label', `画像 ${post.urls.length}枚`);
      post.urls.forEach((url, index) => {
        const link = document.createElement('a');
        // Use the original post's own author path, including when it is a quoted post.
        const base = new URL(links[0].href, location.href);
        base.pathname = base.pathname.replace(/\/photo\/\d+\/?$/, `/photo/${index + 1}`);
        base.search = '';
        base.hash = '';
        link.href = base.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.setAttribute('aria-label', `画像 ${index + 1} / ${post.urls.length} を開く`);
        link.addEventListener('click', event => event.stopPropagation());
        const img = document.createElement('img');
        const thumbnail = new URL(url);
        thumbnail.searchParams.set('name', 'small');
        img.src = thumbnail.href;
        img.alt = `${index + 1} / ${post.urls.length}`;
        img.loading = 'lazy';
        img.decoding = 'async';
        const badge = document.createElement('span');
        badge.textContent = String(index + 1);
        link.append(img, badge);
        grid.append(link);
      });
      original.before(grid);
      original.setAttribute('data-xapg-hidden', 'true');
      rendered.add({id, original, grid});
    }
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { try { update(); } catch { scheduled = false; } }, 400);
  }
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== CHANNEL || event.data.kind !== 'photos' || !Array.isArray(event.data.posts)) return;
    for (const post of event.data.posts.slice(0, 200)) {
      if (!/^\d+$/.test(post?.id || '') || !Array.isArray(post.urls) || post.urls.length < 7 || post.urls.length > 20) continue;
      if (!post.urls.every(url => { try { const u = new URL(url); return u.protocol === 'https:' && u.hostname === 'pbs.twimg.com' && u.pathname.startsWith('/media/'); } catch { return false; } })) continue;
      posts.delete(post.id);
      posts.set(post.id, post);
      while (posts.size > 200) posts.delete(posts.keys().next().value);
    }
    schedule();
  });
  function start() {
    new MutationObserver(schedule).observe(document.documentElement, {childList: true, subtree: true});
    schedule();
  }
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, {once: true});
})();
