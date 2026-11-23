// Everything the app needs from TipTap, bundled into one file (src/vendor/editor.js)
// so the app loads nothing from other sites. Rebuild with: npm install && node build.mjs
export { Editor } from '@tiptap/core';
export { StarterKit } from '@tiptap/starter-kit';
export { TableKit } from '@tiptap/extension-table';
export { TaskList, TaskItem } from '@tiptap/extension-list';
export { TextStyle, Color } from '@tiptap/extension-text-style';
export { Highlight } from '@tiptap/extension-highlight';
export { Image } from '@tiptap/extension-image';
export { Placeholder, CharacterCount } from '@tiptap/extensions';
