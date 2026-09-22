// 小红书 web: feed cards (section.note-item, JS-positioned masonry) and the note modal (#noteContainer).
import { textWithout } from './scholar.js';

const NOTE_ID = /\/explore\/([0-9a-f]{16,32})/;

export const xhsAdapter = {
  id: 'xhs',
  domain: 'xhs',
  defaultSkipMode: 'hide', // 瀑布流里「屏蔽」= 直接隐藏
  masonry: { container: '#exploreFeeds, .feeds-container', cards: 'section.note-item' }, // JS 定位，隐藏后需重排
  matches: (loc) => /(^|\.)xiaohongshu\.com$/.test(loc.hostname),
  findEntries(root) {
    const out = [];
    const modal = noteEntry(root);
    if (modal) out.push(modal);
    for (const card of root.querySelectorAll('section.note-item')) {
      const titleEl = card.querySelector('.footer .title, a.title');
      const footer = card.querySelector('.footer') || titleEl?.parentElement;
      if (!titleEl || !footer) continue;
      const title = textWithout(titleEl, '.pt-badge, .pt-review, .pt-reasons');
      if (!title) continue;
      const href = titleEl.getAttribute('href') || card.querySelector('a.cover')?.getAttribute('href') || '';
      const postId = card.dataset.noteId || (href.match(NOTE_ID) || [, ''])[1];
      out.push({
        id: postId || title,
        containers: [card],
        mount: footer,
        paper: {
          source: 'xhs',
          title,
          abstract: '',
          authors: card.querySelector('.author .name')?.textContent?.trim() || '',
          venue: '小红书',
          url: postId ? `https://www.xiaohongshu.com/explore/${postId}` : '',
          postId,
        },
      });
    }
    return out;
  },
};

/** Note modal / page: full body text; badge on the title; never hidden. */
function noteEntry(root) {
  const container = root.querySelector('#noteContainer');
  const titleEl = container?.querySelector('#detail-title');
  if (!container || !titleEl) return null;
  const desc = container.querySelector('#detail-desc');
  const postId = ((root.defaultView?.location?.pathname || '').match(NOTE_ID) || [, ''])[1] || container.dataset.noteId || '';
  const title = textWithout(titleEl, '.pt-badge, .pt-review, .pt-reasons');
  return {
    id: postId || `note:${title}`,
    single: true,
    noGray: true,
    containers: [titleEl],
    mount: titleEl,
    paper: {
      source: 'xhs',
      title,
      abstract: desc ? textWithout(desc, '.pt-badge') : '',
      abstractFull: !!desc,
      authors: container.querySelector('.author-container .username')?.textContent?.trim() || '',
      venue: '小红书',
      url: postId ? `https://www.xiaohongshu.com/explore/${postId}` : '',
      postId,
    },
  };
}
