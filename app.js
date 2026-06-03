document.addEventListener('DOMContentLoaded', () => {
  const selectFolderButton = document.getElementById('select-folder');
  const binderList = document.getElementById('binder-list');
  const editor = document.getElementById('editor');
  const editorPanel = document.getElementById('editor-panel');
  const contextMenu = document.getElementById('context-menu');
  const fontButtons = contextMenu.querySelectorAll('[data-font]');
  const sizeButtons = contextMenu.querySelectorAll('[data-size]');
  const resizeHandle = document.getElementById('resize-handle');
  const binderPanel = document.getElementById('binder-panel');
  const workspace = document.getElementById('workspace');

  let projectDirHandle = null;

  function hideContextMenu() {
    contextMenu.classList.remove('visible');
  }

  function showContextMenu(x, y) {
    contextMenu.classList.add('visible');
    const rect = editorPanel.getBoundingClientRect();
    const menuRect = contextMenu.getBoundingClientRect();
    let left = x - rect.left;
    let top = y - rect.top;
    if (left + menuRect.width > rect.width) left = rect.width - menuRect.width - 10;
    if (top + menuRect.height > rect.height) top = rect.height - menuRect.height - 10;
    contextMenu.style.left = `${Math.max(left, 10)}px`;
    contextMenu.style.top = `${Math.max(top, 10)}px`;
  }

  function setActiveButton(buttons, attribute, value) {
    buttons.forEach((button) => {
      button.classList.toggle('active', button.dataset[attribute] === value);
    });
  }

  editor.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    showContextMenu(event.clientX, event.clientY);
  });

  document.addEventListener('click', (event) => {
    if (!contextMenu.contains(event.target)) hideContextMenu();
  });

  window.addEventListener('resize', hideContextMenu);
  window.addEventListener('blur', hideContextMenu);

  fontButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const font = button.dataset.font;
      editor.style.fontFamily = font;
      setActiveButton(fontButtons, 'font', font);
      hideContextMenu();
    });
  });

  sizeButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const size = button.dataset.size;
      editor.style.fontSize = size;
      setActiveButton(sizeButtons, 'size', size);
      hideContextMenu();
    });
  });

  editor.style.fontFamily = 'Georgia, serif';
  setActiveButton(fontButtons, 'font', 'Georgia, serif');
  setActiveButton(sizeButtons, 'size', '16px');
  let isResizing = false;

  selectFolderButton.addEventListener('click', async () => {
    try {
      let picker = window.showDirectoryPicker;
      if (typeof picker !== 'function' && typeof window.chooseFileSystemEntries === 'function') {
        picker = () => window.chooseFileSystemEntries({ type: 'open-directory' });
      }
      if (typeof picker !== 'function') {
        throw new Error('File System Access API not available. Open this app in Chrome or Edge on localhost or 127.0.0.1. Do not use 0.0.0.0.');
      }
      projectDirHandle = await picker();
      binderList.innerHTML = '';
      await buildBinder(projectDirHandle);
    } catch (err) {
      console.error('Selection cancelled:', err);
      editor.innerHTML = '<p><em>Could not open project folder. Open the app on <strong>http://localhost:8000</strong> or <strong>http://127.0.0.1:8000</strong> instead of <strong>0.0.0.0</strong>.</em></p>';
    }
  });

  function getAttr(node, ...names) {
    for (const name of names) {
      const value = node.getAttribute(name);
      if (value != null) return value;
    }
    return null;
  }

  function getNodeTitle(node) {
    const titleAttr = getAttr(node, 'Title', 'title');
    if (titleAttr) return titleAttr;
    const titleElement = node.querySelector(':scope > Title');
    return titleElement ? titleElement.textContent.trim() : 'Untitled';
  }

  async function buildBinder(dirHandle) {
    const projectFileName = await findScrivxFile(dirHandle);
    if (!projectFileName) throw new Error('No .scrivx file found in selected folder.');

    const binderXmlHandle = await dirHandle.getFileHandle(projectFileName);
    const file = await binderXmlHandle.getFile();
    const text = await file.text();
    const parser = new DOMParser();
    const xml = parser.parseFromString(text, 'application/xml');

    const binderRoot = xml.querySelector('Binder') || xml.documentElement;
    const topItems = Array.from(binderRoot.querySelectorAll(':scope > BinderItem'));

    binderList.innerHTML = '';
    if (!topItems.length) {
      console.error('No BinderItem nodes found in', binderRoot);
      editor.innerHTML = '<p><em>No binder items found in the selected Scrivener project.</em></p>';
      return;
    }

    topItems.forEach(child => buildTree(child, binderList));
  }

  async function findScrivxFile(dirHandle) {
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind === 'file' && name.toLowerCase().endsWith('.scrivx')) {
        return name;
      }
    }
    return null;
  }

  function buildTree(node, parentEl) {
    const title = getNodeTitle(node);
    const uuid = getAttr(node, 'UUID', 'Id', 'ID', 'id');
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = title;
    span.className = 'binder-item-title';
    span.style.cursor = 'pointer';
    li.appendChild(span);

    const children = Array.from(node.querySelectorAll(':scope > Children > BinderItem'));

    if (children.length) {
      const subList = document.createElement('ul');
      subList.style.display = 'none';
      li.appendChild(subList);
      span.addEventListener('click', () => {
        subList.style.display = subList.style.display === 'none' ? 'block' : 'none';
      });
      children.forEach(child => buildTree(child, subList));
    } else if (uuid) {
      span.addEventListener('click', () => loadDocumentContent(uuid));
    }

    parentEl.appendChild(li);
  }

  async function loadDocumentContent(uuid) {
    try {
      if (!projectDirHandle) return;
      const filesDir = await projectDirHandle.getDirectoryHandle('Files');
      const dataDir = await filesDir.getDirectoryHandle('Data');
      const uuidDir = await dataDir.getDirectoryHandle(uuid);
      const contentFile = await uuidDir.getFileHandle('content.rtf');
      const file = await contentFile.getFile();
      const arrayBuffer = await file.arrayBuffer();
      const rtfText = new TextDecoder('windows-1252').decode(arrayBuffer)
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
      editor.innerHTML = parseRtf(rtfText);
    } catch (err) {
      console.error('Error reading document:', err);
      editor.innerHTML = '<p><em>Could not load document.</em></p>';
    }
  }

  function escapeHtml(value) {
    return value.replace(/[&<>"]/g, (char) => {
      switch (char) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        default: return char;
      }
    });
  }

  function parseRtf(text) {
    const skipKeywords = new Set([
      'fonttbl', 'colortbl', 'datastore', 'stylesheet', 'info', 'pict', 'object', 'field', 'file', 'fontemb', 'footer', 'header', 'footerf', 'footerl', 'footerr', 'headerf', 'headerl', 'headerr', 'stylesheet', 'stylesheet', 'annotation', 'comment', 'private1'
    ]);

    const result = [];
    const stack = [false];
    let ucskip = 1;
    let curskip = 0;
    let ignorable = false;
    let i = 0;

    function skipRtfToken() {
      if (text[i] !== '\\') {
        i += 1;
        return;
      }
      i += 1;
      if (i >= text.length) return;
      const next = text[i];
      if (next === '\\' || next === '{' || next === '}') {
        i += 1;
        return;
      }
      if (next === "*") {
        i += 1;
        return;
      }
      if (next === "'") {
        i += 3;
        return;
      }
      while (i < text.length && /[a-zA-Z]/.test(text[i])) i += 1;
      if (text[i] === '-' || /[0-9]/.test(text[i])) {
        if (text[i] === '-') i += 1;
        while (i < text.length && /[0-9]/.test(text[i])) i += 1;
      }
      if (text[i] === ' ') i += 1;
    }

    while (i < text.length) {
      const ch = text[i];
      if (curskip > 0 && ch !== '\\') {
        curskip -= 1;
        i += 1;
        continue;
      }
      if (ch === '{') {
        stack.push(stack[stack.length - 1]);
        i += 1;
      } else if (ch === '}') {
        stack.pop();
        i += 1;
      } else if (ch === '\\') {
        if (curskip > 0) {
          skipRtfToken();
          curskip -= 1;
          continue;
        }
        i += 1;
        if (i >= text.length) break;

        const next = text[i];
        if (next === '\\' || next === '{' || next === '}') {
          if (!stack[stack.length - 1]) result.push(next);
          i += 1;
        } else if (next === '*') {
          ignorable = true;
          i += 1;
        } else if (next === '~' || next === '_') {
          if (!stack[stack.length - 1]) {
            if (next === '~') result.push('\u00A0');
            else if (next === '_') result.push('-');
          }
          i += 1;
        } else if (next === "'") {
          const hex = text.substr(i + 1, 2);
          i += 3;
          if (!stack[stack.length - 1]) {
            const code = parseInt(hex, 16);
            if (!Number.isNaN(code)) result.push(String.fromCharCode(code));
          }
        } else {
          let start = i;
          while (i < text.length && /[a-zA-Z]/.test(text[i])) i += 1;
          const word = text.slice(start, i);
          let param = '';
          if (text[i] === '-' || /[0-9]/.test(text[i])) {
            const sign = text[i] === '-' ? '-' : '';
            if (text[i] === '-') i += 1;
            while (i < text.length && /[0-9]/.test(text[i])) {
              param += text[i++];
            }
            param = sign + param;
          }
          if (text[i] === ' ') i += 1;
          if (ignorable) {
            stack[stack.length - 1] = true;
            ignorable = false;
          }
          if (stack[stack.length - 1]) continue;
          switch (word) {
            case 'par':
            case 'page':
              result.push('\n\n');
              break;
            case 'line':
              result.push('\n');
              break;
            case 'tab':
              result.push(' ');
              break;
            case 'u': {
              const code = parseInt(param, 10);
              if (!Number.isNaN(code)) {
                const charCode = code < 0 ? 65536 + code : code;
                result.push(String.fromCharCode(charCode));
                curskip = ucskip;
              }
              break;
            }
            case 'uc':
              ucskip = parseInt(param, 10) || 1;
              break;
            case 'ansicpg':
            case 'deff':
            case 'deflang':
            case 'deflangfe':
            case 'f':
            case 'fs':
            case 'cf':
            case 'highlight':
            case 'rtlch':
            case 'b':
            case 'i':
            case 'ul':
            case 'ulnone':
            case 'strike':
            case 'sub':
            case 'super':
            case 'qc':
            case 'ql':
            case 'qr':
            case 'qj':
            case 'li':
            case 'lin':
            case 'fi':
            case 'sb':
            case 'sa':
            case 'sl':
            case 'slmult':
              break;
            default:
              if (skipKeywords.has(word)) {
                stack[stack.length - 1] = true;
              }
              break;
          }
        }
      } else {
        if (curskip > 0) {
          curskip -= 1;
          i += 1;
          continue;
        }
        if (!stack[stack.length - 1]) result.push(ch);
        i += 1;
      }
    }

    const plain = result.join('')
      .replace(/\r?\n/g, '\n')
      .replace(/\s*\n\s*/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    let paragraphs = plain.split(/\n\n+/).map(part => part.trim()).filter(Boolean);
    if (paragraphs.length === 1 && plain.includes('\n')) {
      paragraphs = plain.split(/\n+/).map(part => part.trim()).filter(Boolean);
    }
    return paragraphs.map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
  }

  resizeHandle.addEventListener('pointerdown', (event) => {
    isResizing = true;
    document.body.style.userSelect = 'none';
    resizeHandle.setPointerCapture(event.pointerId);
  });

  document.addEventListener('pointermove', (event) => {
    if (!isResizing) return;
    const minWidth = 180;
    const maxWidth = Math.floor(workspace.clientWidth * 0.7);
    const newWidth = Math.min(Math.max(event.clientX, minWidth), maxWidth);
    binderPanel.style.width = `${newWidth}px`;
  });

  document.addEventListener('pointerup', () => {
    if (!isResizing) return;
    isResizing = false;
    document.body.style.userSelect = '';
  });
});