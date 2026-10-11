// ============================================================================
// ОФИСНЫЕ РЕНДЕРЕРЫ: PDF, WORD (MAMMOTH), EXCEL (XLSX-STYLE)
// ============================================================================

/**
 * Рендеринг страниц PDF с помощью PDF.js
 */
async function renderPdfPages() {
  const container = document.getElementById('viewer-container');
  container.style.background = '#525659';
  
  const savedScrollRatio = container.scrollHeight > 0 
    ? (container.scrollTop / (container.scrollHeight - container.clientHeight)) 
    : null;
    
  container.innerHTML = '';

  for (let pageNum = 1; pageNum <= currentPdf.numPages; pageNum++) {
    try {
      const page = await currentPdf.getPage(pageNum);
      
      if (pageNum === 1 && pdfScale === 1.0) {
        const unscaledViewport = page.getViewport({ scale: 1.0 });
        const cWidth = container.clientWidth - 40;
        if (unscaledViewport.width > 0) {
          autoScaleFactor = Math.round((cWidth / unscaledViewport.width) * 10) / 10;
          if (autoScaleFactor < 0.5) autoScaleFactor = 0.5;
          if (autoScaleFactor > 2.0) autoScaleFactor = 2.0;
          pdfScale = autoScaleFactor;
          
          document.getElementById('zoom-input').value = Math.round(pdfScale * 100) + '%';
          
          const floatingContainer = document.getElementById('floating-controls-container');
          floatingContainer.innerHTML = `
            <button class="reset-zoom-floating" onclick="resetPdfZoomToAuto()">
              По ширине окна (${Math.round(autoScaleFactor * 100)}%)
            </button>
          `;
        }
      }

      const viewport = page.getViewport({ scale: pdfScale });
      const pageWrapper = document.createElement('div');
      pageWrapper.style.position = 'relative';
      pageWrapper.style.width = Math.floor(viewport.width) + 'px';
      pageWrapper.style.height = Math.floor(viewport.height) + 'px';
      pageWrapper.style.margin = '0 auto 15px auto';
      pageWrapper.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
      pageWrapper.style.background = '#fff';

      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.display = 'block';
      pageWrapper.appendChild(canvas);
      container.appendChild(pageWrapper);

      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: viewport }).promise;

      const textContent = await page.getTextContent();
      const textLayerDiv = document.createElement('div');
      textLayerDiv.className = 'textLayer';
      textLayerDiv.style.position = 'absolute';
      textLayerDiv.style.top = '0'; textLayerDiv.style.left = '0';
      textLayerDiv.style.width = '100%'; textLayerDiv.style.height = '100%';
      textLayerDiv.style.overflow = 'hidden';
      textLayerDiv.style.opacity = '0.2';
      pageWrapper.appendChild(textLayerDiv);
      
      pdfjsLib.renderTextLayer({
        textContent: textContent, container: textLayerDiv,
        viewport: viewport, textDivs: []
      });

      const annotations = await page.getAnnotations();
      if (annotations && annotations.length > 0) {
        const annotationLayerDiv = document.createElement('div');
        annotationLayerDiv.className = 'annotationLayer';
        pageWrapper.appendChild(annotationLayerDiv);
        
        annotations.forEach(annot => {
          if (annot.subtype === 'Link' && annot.rect) {
            const rect = viewport.convertToViewportRectangle(annot.rect);
            const left = Math.min(rect[0], rect[2]);
            const top = Math.min(rect[1], rect[3]);
            const width = Math.abs(rect[2] - rect[0]);
            const height = Math.abs(rect[3] - rect[1]);

            const linkWrapper = document.createElement('div');
            linkWrapper.className = 'linkAnnotation';
            linkWrapper.style.left = left + 'px'; linkWrapper.style.top = top + 'px';
            linkWrapper.style.width = width + 'px'; linkWrapper.style.height = height + 'px';

            const a = document.createElement('a');
            if (annot.url) { a.href = annot.url; a.target = '_blank'; }
            else if (annot.dest) { a.href = '#'; a.onclick = (e) => e.preventDefault(); }
            
            linkWrapper.appendChild(a);
            annotationLayerDiv.appendChild(linkWrapper);
          }
        });
      }
    } catch (e) {
      const errorBlock = document.createElement('div');
      errorBlock.style.margin = '0 auto 20px auto'; errorBlock.style.width = '100%';
      errorBlock.style.background = '#fff'; errorBlock.style.padding = '20px';
      errorBlock.style.color = '#c0392b'; errorBlock.style.textAlign = 'center';
      errorBlock.innerText = `⚠️ Ошибка отображения страницы ${pageNum}`;
      container.appendChild(errorBlock);
    }
  }

  if (savedScrollRatio !== null) {
    container.scrollTop = savedScrollRatio * (container.scrollHeight - container.clientHeight);
  }
}

function resetPdfZoomToAuto() {
  pdfScale = autoScaleFactor;
  document.getElementById('zoom-input').value = Math.round(pdfScale * 100) + '%';
  renderPdfPages();
}

/**
 * Рендеринг документов Word (.docx) через Mammoth.js
 */
function renderWord() {
  const container = document.getElementById('viewer-container');
  container.style.background = '#f3f4f6';
  
  mammoth.convertToHtml({ arrayBuffer: currentBlobData })
    .then(result => {
      container.innerHTML = `
        <div id="word-body" style="
          padding: 50px 60px; max-width: 850px; margin: 0 auto; background: #fff;
          box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 4px; min-height:95%;
          font-size: ${14 * pdfScale}px; color: #333; line-height: 1.45; word-break: break-word;
        ">${result.value}</div>
      `;
    })
    .catch(err => {
      container.innerHTML = `<div style="padding:40px; color:#c0392b; text-align:center;">⚠️ Ошибка конвертации Word: ${err.message}</div>`;
    });
}

/**
 * Рендеринг документов Excel с полной поддержкой стилей форматирования xlsx-js-style
 */
function renderExcel() {
  const container = document.getElementById('viewer-container');
  container.style.background = '#e6ecef';
  
  try {
    // ВАЖНО: Читаем с флагами стилей для сохранения оригинального форматирования ячеек
    const workbook = XLSX.read(new Uint8Array(currentBlobData), { 
      type: 'array', 
      cellStyles: true, 
      cellNF: true, 
      cellDates: true, 
      cellHTML: true 
    });
    
    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error("В книге нет доступных листов.");
    }

    if (activeExcelSheetIndex >= workbook.SheetNames.length) {
      activeExcelSheetIndex = 0;
    }
    
    const sheetName = workbook.SheetNames[activeExcelSheetIndex];
    const worksheet = workbook.Sheets[sheetName];

    // Генерируем вкладки листов Excel
    let tabsHtml = `<div style="display:flex; gap:4px; padding:0 15px 8px 15px; border-bottom:1px solid #bdc3c7; margin-bottom:15px; overflow-x:auto; white-space:nowrap; max-width:100%;">`;
    workbook.SheetNames.forEach((name, idx) => {
      const isActive = idx === activeExcelSheetIndex;
      tabsHtml += `
        <button onclick="switchExcelSheet(${idx})" style="
          padding: 6px 12px; font-size: 12px; font-weight: bold; border-radius: 4px; cursor: pointer; transition: all 0.15s;
          border: 1px solid ${isActive ? '#27ae60' : '#ccc'};
          background: ${isActive ? '#27ae60' : '#fff'};
          color: ${isActive ? '#fff' : '#444'};
        ">${name}</button>
      `;
    });
    tabsHtml += `</div>`;

    // Конвертируем лист в HTML (сохраняем оригинальные классы стилей)
    const htmlTableString = XLSX.utils.sheet_to_html(worksheet, { editable: false, header: '', footer: '' });
    
    container.innerHTML = `
      <div style="padding: 15px; width:100%; height:100%; display:flex; flex-direction:column; box-sizing:border-box;">
        ${tabsHtml}
        <div class="excel-table-container" style="flex-grow:1; overflow:auto; padding-bottom:30px; font-size:${13 * pdfScale}px;">
          ${htmlTableString}
        </div>
      </div>
    `;

    // Запускаем точную пост-обработку таблицы
    postProcessExcelTable();
    
  } catch (err) {
    container.innerHTML = `<div style="padding:40px; color:#c0392b; text-align:center;">⚠️ Ошибка чтения Excel: ${err.message}</div>`;
  }
}

function switchExcelSheet(index) {
  activeExcelSheetIndex = index;
  renderExcel();
}

/**
 * Точный алгоритм пост-обработки оригинальной таблицы.
 * Исправляет сдвиг индексов ячеек, возникающий при добавлении сервисной колонки пинов (📌).
 */
function postProcessExcelTable() {
  const container = document.querySelector('.excel-table-container');
  if (!container) return;
  const table = container.querySelector('table');
  if (!table) return;

  const rows = table.querySelectorAll('tr');
  rows.forEach((row, rIdx) => {
    // 1. Создаем ячейку для закрепления строк (📌)
    const lockCell = document.createElement('td');
    lockCell.className = 'row-lock-cell';
    lockCell.innerHTML = `<span class="row-lock-icon">📌</span>`;
    lockCell.title = "Закрепить/открепить строку сверху";
    lockCell.onclick = () => {
      row.classList.toggle('frozen-row');
      const icon = lockCell.querySelector('.row-lock-icon');
      if (row.classList.contains('frozen-row')) {
        icon.classList.add('locked');
      } else {
        icon.classList.remove('locked');
      }
    };
    // Вставляем пин в самое начало строки
    row.insertBefore(lockCell, row.firstChild);

    // 2. Обрабатываем оригинальные ячейки (пропуская lockCell по индексу)
    const cells = row.querySelectorAll('td, th');
    cells.forEach((cell, cIdx) => {
      if (cIdx === 0) return; // Пропускаем только что добавленный lockCell
      
      // Логика добавления кнопок изменения ширины (↔) только для шапки таблицы
      if (rIdx === 0) {
        cell.style.position = 'relative';
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'col-toggle-btn';
        toggleBtn.innerText = '↔';
        toggleBtn.title = "Развернуть / Сжать колонку (включить перенос текста)";
        
        toggleBtn.onclick = (e) => {
          e.stopPropagation();
          toggleBtn.classList.toggle('active');
          
          // Проходим по всем строкам и расширяем ячейку ИМЕННО по текущему сдвинутому индексу cIdx
          const allRows = table.querySelectorAll('tr');
          allRows.forEach(r => {
            const targetCell = r.children[cIdx];
            if (targetCell) {
              targetCell.classList.toggle('expanded-col');
            }
          });
        };
        cell.appendChild(toggleBtn);
      }
    });
  });
}

// Экспортируем функции для инлайнового вызова в onclick
window.switchExcelSheet = switchExcelSheet;
window.resetPdfZoomToAuto = resetPdfZoomToAuto;