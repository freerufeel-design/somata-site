// Базовая логика рендеринга документов, картинок, TXT-файлов и Drag-Image

async function loadAndRenderFile() {
  const container = document.getElementById('viewer-container');
  document.getElementById('floating-controls-container').innerHTML = ''; 
  const file = currentFiles[currentIndex];
  if (!file || !tokenInfo) return;

  container.innerHTML = `<div style="padding: 40px; color: #fff; text-align: center;">⏳ Загрузка файла "${file.name}"...</div>`;
  const fileUrl = `${tokenInfo.baseUrl}/attachments/${file.id}/download?auth=${tokenInfo.token}`;

  const ext = file.name.split('.').pop().toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) { fileTypeMode = 1; }
  else if (['doc', 'docx'].includes(ext)) { fileTypeMode = 2; }
  else if (['xls', 'xlsx'].includes(ext)) { fileTypeMode = 3; }
  else if (ext === 'pdf') { fileTypeMode = 4; }
  else if (['txt', 'csv', 'log', 'json', 'xml', 'sql', 'js', 'css', 'html'].includes(ext)) { fileTypeMode = 5; }
  else { fileTypeMode = 0; }

  try {
    const response = await fetch(fileUrl, { mode: 'cors' });
    if (!response.ok) throw new Error(`Статус ответа ${response.status}`);
    
    if (fileTypeMode === 1) {
      const blob = await response.blob();
      currentImageSrc = URL.createObjectURL(blob);
      renderImage();
    } else if (fileTypeMode === 5) {
      currentBlobData = await response.text();
      renderText();
    } else {
      currentBlobData = await response.arrayBuffer();
      if (fileTypeMode === 4) {
        currentPdf = await pdfjsLib.getDocument({ data: currentBlobData }).promise;
        pdfScale = 1.0; renderPdfPages();
      } else if (fileTypeMode === 2) { renderWord(); }
      else if (fileTypeMode === 3) { renderExcel(); }
      else { renderUnknownFile(file.name); }
    }
    document.getElementById('zoom-input').value = Math.round(pdfScale * 100) + '%';
  } catch (err) {
    container.innerHTML = `<div style="padding: 40px; color: #f2d7d5; text-align: center;">⚠️ Ошибка загрузки контента: ${err.message}</div>`;
  }
}

function renderImage() {
  const container = document.getElementById('viewer-container');
  container.style.background = '#1a1a1a';
  container.innerHTML = `
    <div id="img-wrapper" style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; overflow:auto; cursor:grab; user-select:none;">
      <img id="viewed-image-el" src="${currentImageSrc}" style="max-width:95%; max-height:95%; transform-origin:center center; transition: transform 0.1s ease;" draggable="false" />
    </div>
  `;
  const imgEl = document.getElementById('viewed-image-el');
  const wrapper = document.getElementById('img-wrapper');
  
  imgEl.onload = () => {
    pdfScale = 1.0;
    adjustWrapperSize(imgEl, pdfScale);
  };

  wrapper.addEventListener('mousedown', (e) => {
    if (e.target === imgEl || e.target === wrapper) {
      isDraggingImage = true; wrapper.style.cursor = 'grabbing';
      startX = e.clientX + wrapper.scrollLeft; startY = e.clientY + wrapper.scrollTop;
    }
  });
  window.addEventListener('mousemove', (e) => {
    if (!isDraggingImage) return;
    wrapper.scrollLeft = startX - e.clientX; wrapper.scrollTop = startY - e.clientY;
  });
  window.addEventListener('mouseup', () => {
    isDraggingImage = false; if(wrapper) wrapper.style.cursor = 'grab';
  });
}

function adjustWrapperSize(imgEl, scale) {
  imgEl.style.transform = `scale(${scale})`;
  imgEl.style.maxWidth = scale <= 1.0 ? '95%' : 'none';
  imgEl.style.maxHeight = scale <= 1.0 ? '95%' : 'none';
}

function renderText() {
  const container = document.getElementById('viewer-container');
  container.style.background = '#f8f9fa';
  container.innerHTML = `
    <div style="padding: 25px 40px; max-width: 900px; margin: 0 auto; background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,0.1); border-radius: 4px; min-height:90%;">
      <pre style="white-space: pre-wrap; font-family: monospace; font-size: ${13 * pdfScale}px; color: #2c3e50; line-height:1.5;">${escapeHtml(currentBlobData)}</pre>
    </div>
  `;
}

function renderUnknownFile(name) {
  const container = document.getElementById('viewer-container');
  container.style.background = '#2c3e50';
  container.innerHTML = `
    <div style="padding: 60px 20px; text-align: center; color: #fff;">
      <div style="font-size: 50px; margin-bottom: 15px;">📦</div>
      <h3>Формат не поддерживается для прямого просмотра</h3>
      <p style="opacity: 0.8; font-size: 14px;">Файл: <b>${name}</b></p>
      <button class="action-btn btn-orange" onclick="downloadCurrentFile()" style="margin-top: 15px; padding: 8px 16px; height: auto;">📥 Скачать для просмотра</button>
    </div>
  `;
}

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}