// Обработка операций "Действия" с файлами (Сделать первым, Скачать, Удалить, Перенести, Копировать)

document.getElementById('make-first-btn').addEventListener('click', makeActiveFileFirst);
document.getElementById('download-btn').addEventListener('click', downloadCurrentFile);
document.getElementById('download-all-btn').addEventListener('click', downloadAllFilesAsZip);
document.getElementById('rename-btn').addEventListener('click', renameCurrentFile);
document.getElementById('move-btn').addEventListener('click', () => openRowModal('move'));
document.getElementById('copy-btn').addEventListener('click', () => openRowModal('copy'));
document.getElementById('delete-btn').addEventListener('click', deleteCurrentFile);

async function makeActiveFileFirst() {
  const file = currentFiles[currentIndex];
  if (!file || !rawGristRecordObject) return;
  const fileFieldKey = findAttachmentFieldKey(rawGristRecordObject);
  const currentList = extractAttachmentIds(rawGristRecordObject);
  if (currentList.length <= 1) return;

  const filteredList = currentList.filter(id => id !== file.id);
  const updatedListIds = [file.id, ...filteredList];

  try {
    let tableId = currentTableId || await grist.getSelectedTableId();
    tableId = tableId.replace(/_summary_.*$/, '').replace(/Summary.*$/, '');
    await grist.docApi.applyUserActions([
      ["UpdateRecord", tableId, currentViewedRecordId, { [fileFieldKey]: ['L', ...updatedListIds] }]
    ]);
    setTimeout(async () => {
      document.getElementById('sort-selector').value = 'default';
      const refreshedRecord = allRecords.find(r => r.id === currentViewedRecordId);
      if (refreshedRecord) await processSelectedRecord(refreshedRecord);
    }, 250);
  } catch (error) { alert('Не удалось изменить порядок файлов: ' + error.message); }
}

function downloadCurrentFile() {
  const file = currentFiles[currentIndex];
  if (!file || !tokenInfo) return;
  const fileUrl = `${tokenInfo.baseUrl}/attachments/${file.id}/download?auth=${tokenInfo.token}`;
  const a = document.createElement('a');
  a.href = fileUrl; a.download = file.name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

async function downloadAllFilesAsZip() {
  if (currentFiles.length === 0 || !tokenInfo) return;
  const btn = document.getElementById('download-all-btn');
  const originalText = btn.innerHTML;
  try {
    btn.innerHTML = '⏳ Сборка ZIP...';
    btn.classList.add('loading-zip');
    const zip = new JSZip();
    const downloadPromises = currentFiles.map(async (file) => {
      const fileUrl = `${tokenInfo.baseUrl}/attachments/${file.id}/download?auth=${tokenInfo.token}`;
      const response = await fetch(fileUrl, { mode: 'cors' });
      if (!response.ok) throw new Error(`Ошибка загрузки ${file.name}`);
      const blob = await response.blob();
      zip.file(file.name, blob);
    });
    await Promise.all(downloadPromises);
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const currentRecord = allRecords.find(r => r.id === currentViewedRecordId);
    let archiveName = currentRecord ? getRowName(currentRecord) : `files_row_${currentViewedRecordId}`;
    archiveName = archiveName.replace(/[\/\\?%*:|"<>\s]+/g, '_');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(zipBlob); link.download = `${archiveName}.zip`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  } catch (err) { alert('Не удалось создать архив: ' + err.message); }
  finally { btn.innerHTML = originalText; btn.classList.remove('loading-zip'); }
}

async function renameCurrentFile() {
  const file = currentFiles[currentIndex];
  if (!file) return;
  const lastDotIdx = file.name.lastIndexOf('.');
  const ext = lastDotIdx !== -1 ? file.name.substring(lastDotIdx) : '';
  const baseName = lastDotIdx !== -1 ? file.name.substring(0, lastDotIdx) : file.name;
  const newBaseName = prompt("Введите новое имя для файла:", baseName);
  if (newBaseName === null || newBaseName.trim() === "" || newBaseName.trim() === baseName) return;
  const finalFullName = newBaseName.trim() + ext;

  try {
    let tableId = currentTableId || await grist.getSelectedTableId();
    tableId = tableId.replace(/_summary_.*$/, '').replace(/Summary.*$/, '');
    await grist.docApi.applyUserActions([
      ["UpdateRecord", "_grist_Attachments", file.id, { "fileName": finalFullName }]
    ]);
    file.name = finalFullName;
    applyFileSorting(); updateToolbar();
    alert("Файл успешно переименован!");
  } catch (e) { alert("Не удалось переименовать файл: " + e.message); }
}

async function deleteCurrentFile() {
  const file = currentFiles[currentIndex];
  if (!file || !rawGristRecordObject) return;
  if (!confirm(`Вы действительно хотите удалить файл "${file.name}" из этой записи?`)) return;

  const fileFieldKey = findAttachmentFieldKey(rawGristRecordObject);
  const currentList = extractAttachmentIds(rawGristRecordObject);
  const updatedList = currentList.filter(id => id !== file.id);

  try {
    let tableId = currentTableId || await grist.getSelectedTableId();
    tableId = tableId.replace(/_summary_.*$/, '').replace(/Summary.*$/, '');
    await grist.docApi.applyUserActions([
      ["UpdateRecord", tableId, currentViewedRecordId, { [fileFieldKey]: ['L', ...updatedList] }]
    ]);
    setTimeout(async () => {
      const refreshedRecord = allRecords.find(r => r.id === currentViewedRecordId);
      if (refreshedRecord) await processSelectedRecord(refreshedRecord);
    }, 200);
  } catch (err) { alert("Ошибка удаления: " + err.message); }
}

function openRowModal(actionType) {
  const file = currentFiles[currentIndex];
  if (!file) return;
  
  const modalContainer = document.getElementById('modal-container');
  const title = actionType === 'move' ? 'Перенос файла в другую строку' : 'Копирование файла в другую строку';
  const actionText = actionType === 'move' ? 'перенести' : 'скопировать';

  let rowsHtml = '';
  filteredRows.forEach(row => {
    if (row.id === currentViewedRecordId && actionType === 'move') return; 
    rowsHtml += `<div class="modal-row-item" onclick="executeRowAction('${actionType}', ${row.id})">📍 ${getRowName(row)}</div>`;
  });

  modalContainer.innerHTML = `
    <div class="modal-overlay" id="custom-modal-overlay">
      <div class="modal-box">
        <div class="modal-header">
          <span>${title}</span>
          <button class="modal-close" onclick="closeRowModal()">&times;</button>
        </div>
        <div class="modal-body">
          <div class="modal-file-info">📄 Вы собираетесь ${actionText} файл:<br><b>${file.name}</b></div>
          <div style="font-size:12px; color:#666; font-weight:bold; margin-bottom:2px;">Выберите целевую запись:</div>
          <div class="modal-rows-list">${rowsHtml || '<div style="padding:15px; text-align:center; color:#999;">Нет доступных строк</div>'}</div>
        </div>
      </div>
    </div>
  `;
}

function closeRowModal() {
  document.getElementById('modal-container').innerHTML = '';
}

async function executeRowAction(actionType, targetRowId) {
  const file = currentFiles[currentIndex];
  if (!file || !rawGristRecordObject) return;

  const targetRow = allRecords.find(r => r.id === targetRowId);
  if (!targetRow) { alert("Целевая строка не найдена."); return; }

  const fileFieldKey = findAttachmentFieldKey(rawGristRecordObject);
  const sourceList = extractAttachmentIds(rawGristRecordObject);
  const targetList = extractAttachmentIds(targetRow);

  if (!targetList.includes(file.id)) { targetList.push(file.id); }
  const actions = [];
  let tableId = currentTableId;

  try {
    if (!tableId && typeof grist.getSelectedTableId === 'function') tableId = await grist.getSelectedTableId();
    tableId = tableId.replace(/_summary_.*$/, '').replace(/Summary.*$/, '');

    actions.push(["UpdateRecord", tableId, targetRowId, { [fileFieldKey]: ['L', ...targetList] }]);

    if (actionType === 'move') {
      const updatedSourceList = sourceList.filter(id => id !== file.id);
      actions.push(["UpdateRecord", tableId, currentViewedRecordId, { [fileFieldKey]: ['L', ...updatedSourceList] }]);
    }

    closeRowModal();
    const container = document.getElementById('viewer-container');
    container.innerHTML = `<div style="padding:40px; color:#fff; text-align:center;">⏳ Выполнение операции базы данных...</div>`;
    
    await grist.docApi.applyUserActions(actions);
    
    setTimeout(async () => {
      const refreshedRecord = allRecords.find(r => r.id === currentViewedRecordId);
      if (refreshedRecord) await processSelectedRecord(refreshedRecord);
    }, 250);

  } catch (err) { alert("Ошибка проведения операции: " + err.message); closeRowModal(); processSelectedRecord(rawGristRecordObject); }
}