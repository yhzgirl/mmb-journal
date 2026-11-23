// One editor set-up for reading and writing, so an entry looks the same in both.
// The editor only keeps formatting it knows (its "schema"), which also means stray
// scripts or odd HTML in old entries are never shown or run.

import { Editor, StarterKit, TableKit, TaskList, TaskItem, TextStyle, Color, Highlight, Image, Placeholder } from './vendor/editor.js';

export const TEXT_COLOURS = [
  ['Default', null], ['Purple', '#5a1a90'], ['Pink', '#b5156c'], ['Lime', '#4a6b22'],
  ['Blue', '#1f5fa8'], ['Orange', '#b45309'], ['Grey', '#6a6e80']
];
export const HIGHLIGHTS = [['Yellow', '#fde68a'], ['Pink', '#fbcfe8'], ['Lime', '#d9f99d'], ['Lilac', '#e9d5ff'], ['Blue', '#bfdbfe']];

export function createEditor(element, { html = '', editable = false, placeholder = 'Write…', onUpdate } = {}) {
  return new Editor({
    element,
    editable,
    content: html,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        codeBlock: false, code: false,
        link: { openOnClick: !editable, autolink: true, defaultProtocol: 'https',
          HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } }
      }),
      TableKit.configure({ table: { resizable: false } }),
      TaskList, TaskItem.configure({ nested: true }),
      TextStyle, Color,
      Highlight.configure({ multicolor: true }),
      Image.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({ placeholder })
    ],
    editorProps: { attributes: { class: 'prose', ...(editable ? { 'aria-label': 'Entry text', role: 'textbox', 'aria-multiline': 'true' } : {}) } },
    onUpdate: onUpdate ? ({ editor }) => onUpdate(editor) : undefined
  });
}
