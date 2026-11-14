(() => {
  'use strict';
  const CHANNEL = 'x-all-photo-grid-v1';
  // This version never replaces fetch, XHR, or any application function.
  let pending = false;
  let requested = [];

  // Keep only public photo URLs and the post ID; discard all other response data.
  function extract(roots, wanted) {
    const stack = roots.map(value => ({value, depth: 0}));
    const seen = new WeakSet();
    const found = [];
    let visited = 0;
    while (stack.length && visited++ < 2500) {
      const {value: item, depth} = stack.pop();
      if (!item || typeof item !== 'object' || seen.has(item)) continue;
      if (item.nodeType || item === window) continue;
      seen.add(item);
      const legacy = item.legacy || item;
      const id = item.rest_id || legacy.id_str;
      const media = legacy.extended_entities?.media;
      if (wanted.has(String(id)) && Array.isArray(media) && media.length > 6 && media.length <= 20 && media.every(m => m.type === 'photo')) {
        const urls = media.map(m => m.media_url_https).filter(url => {
          try { const u = new URL(url); return u.protocol === 'https:' && u.hostname === 'pbs.twimg.com' && u.pathname.startsWith('/media/'); }
          catch { return false; }
        });
        if (urls.length === media.length) found.push({id: String(id), urls});
      }
      if (depth >= 9) continue;
      // Do not invoke getters or traverse the React graph itself.
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
        if (['return', 'child', 'sibling', 'alternate', 'stateNode', '_owner', 'ref'].includes(key)) continue;
        const value = descriptor.value;
        if (value && typeof value === 'object') stack.push({value, depth: depth + 1});
      }
    }
    return found;
  }

  function scan() {
    pending = false;
    const wanted = new Set(requested);
    const found = new Map();
    let count = 0;
    for (const article of document.querySelectorAll('article')) {
      if (++count > 100 || found.size >= wanted.size) break;
      const ids = [...article.querySelectorAll('a[href*="/photo/"]')].map(a => a.href.match(/\/status\/(\d+)\/photo\//)?.[1]);
      if (!ids.some(id => wanted.has(id))) continue;
      try {
        const keys = Object.keys(article);
        const props = keys.find(key => key.startsWith('__reactProps$'));
        const fiber = keys.find(key => key.startsWith('__reactFiber$'));
        const roots = [];
        if (props) roots.push(article[props]);
        let node = fiber && article[fiber];
        for (let level = 0; node && level < 18; level++, node = node.return) {
          if (node.memoizedProps) roots.push(node.memoizedProps);
        }
        // Pop nearest component props first, before unrelated higher ancestors.
        for (const post of extract(roots.reverse(), wanted)) found.set(post.id, post);
      } catch { /* Leave the native gallery untouched if data is unavailable. */ }
    }
    if (found.size) window.postMessage({channel: CHANNEL, kind: 'photos', posts: [...found.values()]}, location.origin);
  }
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== CHANNEL || event.data.kind !== 'request' || !Array.isArray(event.data.ids)) return;
    requested = event.data.ids.filter(id => typeof id === 'string' && /^\d+$/.test(id)).slice(0, 8);
    if (requested.length && !pending) {
      pending = true;
      setTimeout(scan, 50);
    }
  });
})();
