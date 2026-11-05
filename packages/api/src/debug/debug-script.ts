export const debugScript = `
document.documentElement.classList.add('scripted');
document.addEventListener('DOMContentLoaded', () => {
  const byId = (id) => document.getElementById(id);
  const every = (selector) => [...document.querySelectorAll(selector)];
  const switches = every('[data-switch]');
  const prefixes = new Map(switches.map((link) => [link.dataset.switch, link.dataset.prefix]));
  const labels = new Map(switches.map((link) => [link.dataset.switch, link.dataset.label]));
  const rail = document.querySelector('.rail');
  const toggle = document.querySelector('[data-contents]');
  const picker = document.querySelector('[data-connections]');
  const narrow = matchMedia('(max-width: 820px)');
  let current = 'mcp';
  function connectionOf(hash) {
    const named = [...prefixes].find(([, prefix]) => prefix !== '' && hash.startsWith(prefix));
    return named === undefined ? 'mcp' : named[0];
  }
  function holds(element, key) {
    const shelf = element.closest('.shelf');
    return shelf === null || shelf.dataset.connections.split(' ').includes(key);
  }
  function fits(element, key) {
    if (element === null || element.closest('.view') === null) return false;
    const owner = element.closest('.connection');
    return owner === null ? holds(element, key) : owner.dataset.connection === key;
  }
  function targetOf(hash, key) {
    const prefix = prefixes.get(key);
    return [byId(hash), byId(hash.slice(prefix.length)), byId(prefix + 'instructions')].find((at) => fits(at, key));
  }
  function show(key, target, hash) {
    current = key;
    const view = target.closest('.view');
    for (const part of every('.connection, .tree')) part.classList.toggle('on', part.dataset.connection === key);
    for (const shelf of every('.shelf')) shelf.classList.toggle('on', holds(shelf, key));
    for (const each of every('.view')) each.classList.toggle('on', each === view);
    for (const link of switches) link.classList.toggle('on', link.dataset.switch === key);
    for (const link of every('.tree a')) link.classList.toggle('on', link.getAttribute('href') === '#' + hash);
    for (const group of every('.tree details')) if (group.querySelector('a.on') !== null) group.open = true;
    picker.value = prefixes.get(key) + 'instructions';
    if (narrow.matches) folded(true);
    requestAnimationFrame(() => {
      if (target !== view) target.scrollIntoView({ block: 'start' });
      else for (const scroller of [document.querySelector('main'), window]) scroller.scrollTo(0, 0);
    });
  }
  function folded(fold) {
    rail.classList.toggle('open', !fold);
    toggle.setAttribute('aria-expanded', String(!fold));
  }
  function route() {
    const hash = decodeURIComponent(location.hash.slice(1));
    const key = connectionOf(hash);
    show(key, targetOf(hash, key), hash);
  }
  function go(entry) {
    if (entry.link !== null) {
      location.hash = entry.link.getAttribute('href');
      return;
    }
    const owner = entry.element.closest('.connection, .shelf');
    const key = owner.classList.contains('connection')
      ? owner.dataset.connection
      : holds(owner, current) ? current : owner.dataset.connections.split(' ')[0];
    const view = entry.element.closest('.view');
    const hash = view.id.startsWith(prefixes.get(key)) ? view.id : prefixes.get(key) + view.id;
    history.replaceState(null, '', '#' + hash);
    show(key, entry.element, hash);
  }
  const palette = byId('palette');
  const input = palette.querySelector('input');
  const results = palette.querySelector('ol');
  let index = null;
  let found = [];
  let chosen = 0;
  function entryOf(element, rank, link) {
    const text = element.textContent.replace(/\\s+/g, ' ').trim();
    const where = element.closest('[data-connection]');
    const titled = element.closest('[data-title]');
    const shelf = element.closest('.shelf');
    const label = where === null ? shelf.dataset.label : labels.get(where.dataset.connection);
    const context = [label, titled === null ? '' : titled.dataset.title].filter((part) => part !== '').join(' · ');
    return { element, rank, link, text, lower: text.toLowerCase(), context };
  }
  function indexed() {
    const blocks = '.view p, .view td, .view pre, .view blockquote, .view li, .view dd';
    return [
      ...every('.tree a').map((link) => entryOf(link, 1, link)),
      ...every('.view h1, .view h2, .view h3, .view h4').map((heading) => entryOf(heading, 1, null)),
      ...every(blocks)
        .filter((block) => block.closest('details.markdown') === null && block.querySelector('p, pre') === null)
        .map((block) => entryOf(block, 2, null)),
    ];
  }
  function snippetOf(entry, word) {
    const at = entry.lower.indexOf(word);
    const start = Math.max(0, at - 40);
    const item = document.createElement('span');
    const mark = document.createElement('mark');
    mark.textContent = entry.text.slice(at, at + word.length);
    item.append(start > 0 ? '…' : '', entry.text.slice(start, at), mark, entry.text.slice(at + word.length, at + 100));
    return item;
  }
  function listed() {
    results.replaceChildren(
      ...found.map((entry, place) => {
        const item = document.createElement('li');
        const context = document.createElement('small');
        context.textContent = entry.context;
        item.append(snippetOf(entry, entry.first), context);
        item.classList.toggle('chosen', place === chosen);
        item.addEventListener('click', () => choose(place));
        return item;
      }),
    );
    results.children[chosen]?.scrollIntoView({ block: 'nearest' });
  }
  function search() {
    const words = input.value.toLowerCase().split(/\\s+/).filter((word) => word !== '');
    index ??= indexed();
    const query = words.join(' ');
    found = words.length === 0 ? [] : index
      .filter((entry) => words.every((word) => entry.lower.includes(word)))
      .map((entry) => ({ ...entry, first: words[0], order: entry.link !== null && entry.lower === query ? 0 : entry.rank }))
      .sort((one, other) => one.order - other.order || (other.context.startsWith(labels.get(current)) - one.context.startsWith(labels.get(current))))
      .slice(0, 60);
    chosen = 0;
    listed();
  }
  function choose(place) {
    const entry = found[place];
    if (entry === undefined) return;
    palette.close();
    go(entry);
  }
  function open() {
    palette.showModal();
    input.select();
    search();
  }
  input.addEventListener('input', search);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      chosen = Math.min(found.length - 1, Math.max(0, chosen + (event.key === 'ArrowDown' ? 1 : -1)));
      listed();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(chosen);
    }
  });
  palette.addEventListener('click', (event) => {
    if (event.target === palette) palette.close();
  });
  for (const button of every('[data-search]')) button.addEventListener('click', open);
  document.addEventListener('keydown', (event) => {
    const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
    if ((event.key === 'k' && (event.metaKey || event.ctrlKey)) || (event.key === '/' && !typing && !palette.open)) {
      event.preventDefault();
      open();
    }
  });
  toggle.addEventListener('click', () => folded(rail.classList.contains('open')));
  picker.addEventListener('change', () => {
    location.hash = picker.value;
  });
  history.scrollRestoration = 'manual';
  window.addEventListener('hashchange', route);
  window.addEventListener('load', route);
  route();
});
`;
