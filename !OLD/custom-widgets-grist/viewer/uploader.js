// Логика добавления новых файлов (Uploader, Drag & Drop, Буфер обмена Ctrl+V)

function renderUploadInterface() {
  document.getElementById('floating-controls-container').innerHTML = ''; 
  const container = document.getElementById('viewer-container');
  container.style.background = '#2c3e50'; 
  container.innerHTML = `
    <div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; padding: 20px; box-sizing:border-box;">
      <div class="upload-zone" id="drop-zone" tabindex="0" style="width:100%;">
        <h3>📥 Добавление файла в запись</h3>
        <p><b>Способ 1:</b> Нажмите сюда, чтобы выбрать файл на компьютере</p>
        <p><b>Способ 2:</b> Перетащите файл мышкой прямо в это окно</p>
        <p><b>Способ 3:</b> Нажмите на эту область и вставьте файл/скриншот через <span class="kbd-tip">Ctrl + V</span></p>
        <input type="file" id="manual-file-input" style="display:none;" />
      </div>
    </div>
  `;

  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('manual-file-input');
  if (!dropZone) return;
  dropZone.focus(); 

  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => { if (e.target.files.length > 0) handleUploadedFile(e.target.files[0]); });

  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault(); dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) handleUploadedFile(e.dataTransfer.files[0]);
  });

  dropZone.addEventListener('paste', (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        const blob = items[i].getAsFile();
        if (blob) {
          if (blob.name === "image.png" || !blob.name) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const fileFromBlob = new File([blob], `Скриншот_${timestamp}.png`, { type: blob.type });
            handleUploadedFile(fileFromBlob);
          } else { handleUploadedFile(blob); }
          break;
        }
      }
    }
  });
}

async function handleUploadedFile(fileObject) {
  const container = document.getElementById('viewer-container');
  container.innerHTML = `<div style="padding: 40px; color: #fff; text-align: center;">⏳ Отправка файла "${fileObject.name}" на сервер Grist...</div>`;

  try {
    let tableId = currentTableId || await grist.getSelectedTableId();
    tableId = tableId.replace(/_summary_.*$/, '').replace(/Summary.*$/, '');
    if (!tokenInfo || !tokenInfo.token) throw new Error("Маркер доступа Grist еще не загружен.");

    const formData = new FormData();
    formData.append('upload', fileObject);

    const uploadUrl = `${tokenInfo.baseUrl}/attachments?auth=${tokenInfo.token}`;
    const response = await fetch(uploadUrl, {
      method: 'POST', body: formData, mode: 'cors',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });

    if (!response.ok) throw new Error(`Сервер ответил ошибкой (${response.status})`);
    const resultIds = await response.json();
    const newAttachmentId = resultIds[0];
    const fileFieldKey = findAttachmentFieldKey(rawGristRecordObject);
    const currentList = (!currentViewedRecordId || currentViewedRecordId === 0) ? [] : extractAttachmentIds(rawGristRecordObject);
    const isFirstFile = currentList.length === 0;

    let finalRowName = null;
    if (isFirstFile) {
        const lastDotIdx = fileObject.name.lastIndexOf('.');
        const defaultRowName = lastDotIdx !== -1 ? fileObject.name.substring(0, lastDotIdx) : fileObject.name;
        const userDefinedName = prompt("Файл успешно прикреплен! Введите название записи:", defaultRowName);
        finalRowName = (userDefinedName && userDefinedName.trim() !== "") ? userDefinedName.trim() : defaultRowName;
    }

    if (!currentViewedRecordId || currentViewedRecordId === 0) {
      const createAction = [["AddRecord", tableId, null, { [fileFieldKey]: ['L', newAttachmentId], "Название": finalRowName || fileObject.name }]];
      await grist.docApi.applyUserActions(createAction);
    } else {
      if (!currentList.includes(newAttachmentId)) currentList.push(newAttachmentId);
      const updatePayload = { [fileFieldKey]: ['L', ...currentList] };
      if (isFirstFile && finalRowName) {
         if ('Название' in rawGristRecordObject) updatePayload['Название'] = finalRowName;
         else {
             for (const key in rawGristRecordObject) {
                 if (key !== 'id' && !Array.isArray(rawGristRecordObject[key]) && typeof rawGristRecordObject[key] === 'string') {
                     updatePayload[key] = finalRowName; break;
                 }
             }
         }
      }
      await grist.docApi.applyUserActions([["UpdateRecord", tableId, currentViewedRecordId, updatePayload]]);
    }

    container.innerHTML = `<div style="padding: 40px; color: #52be80; text-align: center;">Данные привязаны! Синхронизация...</div>`;
    setTimeout(async () => {
      try {
        const data = await grist.docApi.fetchTable(tableId);
        const keys = Object.keys(data); const records = [];
        for (let i = 0; i < data.id.length; i++) {
          const row = {}; keys.forEach(k => { row[k] = data[k][i]; }); records.push(row);
        }
        allRecords = records;
        let targetId = currentViewedRecordId || gristSelectedRecordId || data.id[data.id.length - 1];
        const refreshedRecord = allRecords.find(r => r.id === targetId);
        if (refreshedRecord) {
          await processSelectedRecord(refreshedRecord);
          if (currentFiles.length > 0) switchFile(currentFiles.length - 1);
        } else { location.reload(); }
      } catch (e) { location.reload(); }
    }, 400);

  } catch (err) { alert("Ошибка сохранения: " + err.message); processSelectedRecord(rawGristRecordObject); }
}