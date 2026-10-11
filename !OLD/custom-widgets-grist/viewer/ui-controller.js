// Логика управления пользовательским интерфейсом и события тулбара

document.getElementById('prev-btn').addEventListener('click', () => switchFile(currentIndex - 1));
document.getElementById('next-btn').addEventListener('click', () => switchFile(currentIndex + 1));
document.getElementById('file-selector').addEventListener('change', (e) => switchFile(parseInt(e.target.value, 10)));
document.getElementById('row-selector').addEventListener('change', (e) => switchRow(parseInt(e.target.value, 10)));
document.getElementById('refresh-btn').addEventListener('click', resetToGristRecord);

document.getElementById('sort-selector').addEventListener('change', () => {
  applyFileSorting();
  updateToolbar();
});

document.getElementById('zoom-in').addEventListener('click', () => changeZoom(0.1));
document.getElementById('zoom-out').addEventListener('click', () => changeZoom(-0.1));
document.getElementById('zoom-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    let val = parseInt(this.value.replace('%', ''), 10);
    if (!isNaN(val) && val > 10 && val < 1000) {
      pdfScale = val / 100;
      applyZoom();
    } else {
      this.value = Math.round(pdfScale * 100) + '%';
    }
  }
});

function updateToolbarUI() {
  const toolbar = document.getElementById('toolbar');
  const refreshBtn = document.getElementById('refresh-btn');
  const rowLabel = document.getElementById('row-label');
  const fileLabel = document.getElementById('file-label');
  const sortIndicator = document.getElementById('sort-icon-indicator');

  if (isSubTabMode) {
    toolbar.classList.add('subtab-mode');
    toolbar.style.background = '#fcf3cf'; 
    toolbar.style.color = '#333';
    rowLabel.style.color = '#7e5109';
    fileLabel.style.color = '#7e5109';
    if (sortIndicator) sortIndicator.style.color = '#7e5109';
    refreshBtn.style.display = 'inline-flex';
  } else {
    toolbar.classList.remove('subtab-mode');
    toolbar.style.background = '#2c3e50';
    toolbar.style.color = '#fff';
    rowLabel.style.color = '#bdc3c7';
    fileLabel.style.color = '#bdc3c7';
    if (sortIndicator) sortIndicator.style.color = '#bdc3c7';
    refreshBtn.style.display = 'none';
  }
}

function applyFileSorting() {
  if (currentFiles.length <= 1) return;
  const sortMode = document.getElementById('sort-selector').value;
  const activeFileId = currentFiles[currentIndex] ? currentFiles[currentIndex].id : null;

  if (sortMode === 'name') {
    currentFiles.sort((a, b) => a.name.localeCompare(b.name, 'ru', { sensitivity: 'base', numeric: true }));
  } else {
    currentFiles.sort((a, b) => a.originalIndex - b.originalIndex);
  }

  if (activeFileId !== null) {
    const newIdx = currentFiles.findIndex(f => f.id === activeFileId);
    if (newIdx !== -1) currentIndex = newIdx;
  }
}

function updateRowSelector(currentRecordId) {
  const rowSelector = document.getElementById('row-selector');
  const rowLabel = document.getElementById('row-label');
  rowSelector.innerHTML = '';
  const totalCount = filteredRows.length;
  rowLabel.innerText = `Строка (${totalCount}):`;

  if (totalCount === 0 || !filteredRows[0]) {
    rowSelector.innerHTML = '<option value="0">Новая запись (сводная)</option>';
    return;
  }

  filteredRows.forEach((row, idx) => {
    if (!row) return;
    const option = document.createElement('option');
    option.value = row.id;
    const rowName = getRowName(row);
    const fileIds = extractAttachmentIds(row);
    let label = `${idx + 1}. ${rowName}`;
    if (fileIds.length > 0) label += ` (${fileIds.length})`;
    option.innerText = label;
    if (row.id === currentRecordId) option.selected = true;
    rowSelector.appendChild(option);
  });
}

async function switchRow(rowId) {
  if (rowId === 0) return;
  const targetRecord = allRecords.find(r => r.id === rowId);
  if (targetRecord) await processSelectedRecord(targetRecord);
}

function updateToolbar() {
  const selector = document.getElementById('file-selector');
  const counter = document.getElementById('file-counter');
  selector.innerHTML = '';

  if (currentFiles.length === 0) {
    counter.innerText = '0 из 0';
    selector.innerHTML = '<option value="">Нет файлов</option>';
    return;
  }

  counter.innerText = `${currentIndex + 1} из ${currentFiles.length}`;
  currentFiles.forEach((file, index) => {
    const option = document.createElement('option');
    option.value = index;
    option.innerText = `${index + 1}. ${file.name}`;
    if (index === currentIndex) option.selected = true;
    selector.appendChild(option);
  });
}

function switchFile(newIndex) {
  if (newIndex >= 0 && newIndex < currentFiles.length) {
    currentIndex = newIndex;
    activeExcelSheetIndex = 0;
    updateToolbar();
    loadAndRenderFile();
  }
}

function changeZoom(delta) {
  let newScale = pdfScale + delta;
  if (newScale >= 0.2 && newScale <= 6.0) { pdfScale = Math.round(newScale * 10) / 10; applyZoom(); }
}

function applyZoom() {
  document.getElementById('zoom-input').value = Math.round(pdfScale * 100) + '%';
  if (fileTypeMode === 1) {
    const imgEl = document.getElementById('viewed-image-el');
    if (imgEl && typeof adjustWrapperSize === 'function') adjustWrapperSize(imgEl, pdfScale);
  } else if (fileTypeMode === 2) {
    if (typeof renderWord === 'function') renderWord(); 
  } else if (fileTypeMode === 3) {
    if (typeof renderExcel === 'function') renderExcel(); 
  } else if (fileTypeMode === 5) {
    if (typeof renderText === 'function') renderText();
  } else if (fileTypeMode === 4 && currentPdf) {
    if (typeof renderPdfPages === 'function') renderPdfPages();
  }
}