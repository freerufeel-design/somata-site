// Конфигурация ядра и глобальное состояние
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

const BRAND_COL = 'E';      
let currentTableId = null;  
let tokenInfo = null;
let allRecords = [];           
let filteredRows = [];         
let currentFiles = []; 
let currentIndex = 0;  
let currentPdf = null; 
let currentBlobData = null; 
let currentImageSrc = null;

let gristSelectedRecordId = null; 
let currentViewedRecordId = null;  
let rawGristRecordObject = null; 
let isSubTabMode = false;

let fileTypeMode = 0; 
let pdfScale = 1.0; 
let autoScaleFactor = 1.0; 
let activeExcelSheetIndex = 0;

let isDraggingImage = false;
let startX, startY;

// Инициализация API Grist
grist.ready({ requiredAccess: 'full', onEditOptions: function() {} });

grist.onOptions(function(options, interaction) {
  if (interaction && interaction.tableId) {
    currentTableId = interaction.tableId.replace(/_summary_.*$/, '').replace(/Summary.*$/, '');
  }
});

grist.docApi.getAccessToken({ readOnly: false }).then(info => { tokenInfo = info; });

grist.onRecords(function(records) { allRecords = records; });
grist.onRecord(async function(record) {
  if (!record) {
    rawGristRecordObject = { id: 0 };
    if (typeof renderUploadInterface === 'function') renderUploadInterface();
    return;
  }
  gristSelectedRecordId = record.id;
  await processSelectedRecord(record);
});

// Служебные функции парсинга Grist
function parseBrands(brandValue) {
  if (!brandValue) return [];
  if (Array.isArray(brandValue)) return brandValue.filter(b => b !== 'L' && b !== 'C' && b !== null && b !== undefined).map(b => String(b).trim());
  return String(brandValue).split(/[,;;\n]+/).map(b => b.trim()).filter(b => b.length > 0);
}

function findAttachmentFieldKey(record) {
  if (!record) return "Прикрепы";
  for (const key in record) {
    if (Object.prototype.hasOwnProperty.call(record, key) && key !== 'id') {
      const val = record[key];
      if (val && val !== 'L' && Array.isArray(val)) return key;
    }
  }
  const commonKeys = ['Прикрепы', 'Файлы', 'Файл', 'Вложения', 'Attachments', 'Attachment', 'Files'];
  for (const k of commonKeys) { if (k in record) return k; }
  return "Прикрепы";
}

function extractAttachmentIds(record) {
  if (!record) return [];
  let rawIds = [];
  for (const key in record) {
    if (Object.prototype.hasOwnProperty.call(record, key) && key !== 'id') {
      const value = record[key];
      if (value && value !== 'L' && Array.isArray(value)) {
        value.forEach(item => {
          if (item && typeof item === 'object' && 'id' in item) rawIds.push(item.id);
          else if (typeof item === 'number') rawIds.push(item);
        });
      }
    }
  }
  return [...new Set(rawIds)];
}

function getRowName(row) {
  if (!row) return "Новая запись";
  if (row.Название) return row.Название;
  for (const key in row) {
    if (Object.prototype.hasOwnProperty.call(row, key) && !Array.isArray(row[key]) && key !== 'id') {
      if (typeof row[key] === 'string' && row[key].trim().length > 0) return row[key];
    }
  }
  return row.id ? `Строка ID ${row.id}` : "Новая запись";
}

async function processSelectedRecord(record) {
  if (!record) return;
  currentViewedRecordId = record.id;
  rawGristRecordObject = record; 

  isSubTabMode = (gristSelectedRecordId !== null && currentViewedRecordId !== gristSelectedRecordId);
  if (typeof updateToolbarUI === 'function') updateToolbarUI();

  const baseRecord = allRecords.find(r => r.id === gristSelectedRecordId) || record;
  const searchBrands = parseBrands(baseRecord[BRAND_COL]);
  
  if (searchBrands.length > 0 && allRecords.length > 0) {
    filteredRows = allRecords.filter(r => {
      const rowBrands = parseBrands(r[BRAND_COL]);
      return rowBrands.some(b => searchBrands.includes(b));
    });
  } else {
    filteredRows = [baseRecord];
  }

  if (typeof updateRowSelector === 'function') updateRowSelector(currentViewedRecordId);

  const rawIds = extractAttachmentIds(record);
  currentFiles = [];
  currentIndex = 0;
  currentPdf = null;
  currentBlobData = null;
  currentImageSrc = null;
  activeExcelSheetIndex = 0;

  if (rawIds.length > 0) {
    try {
      const attachmentsTable = await grist.docApi.fetchTable('_grist_Attachments');
      currentFiles = rawIds.map((id, idx) => {
        const fileRowIndex = attachmentsTable.id.indexOf(id);
        let realName = `Файл ${idx + 1}`;
        if (fileRowIndex !== -1 && attachmentsTable.fileName && attachmentsTable.fileName[fileRowIndex]) {
          realName = attachmentsTable.fileName[fileRowIndex];
        }
        return { id: id, name: realName, originalIndex: idx };
      });
    } catch (err) {
      currentFiles = rawIds.map((id, idx) => ({ id: id, name: `Файл ${idx + 1} (ID: ${id})`, originalIndex: idx }));
    }
  }

  applyFileSorting();
  if (typeof updateToolbar === 'function') updateToolbar();

  const hasFiles = currentFiles.length > 0;
  const elements = ['make-first-btn', 'download-btn', 'download-all-btn', 'rename-btn', 'move-btn', 'copy-btn', 'delete-btn'];
  elements.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = hasFiles ? 'block' : 'none';
  });

  if (hasFiles) {
    if (typeof loadAndRenderFile === 'function') loadAndRenderFile();
  } else {
    if (typeof renderUploadInterface === 'function') renderUploadInterface();
  }
}

async function resetToGristRecord() {
  if (!gristSelectedRecordId || allRecords.length === 0) return;
  const originalRecord = allRecords.find(r => r.id === gristSelectedRecordId);
  if (originalRecord) {
    isSubTabMode = false;
    updateToolbarUI();
    await processSelectedRecord(originalRecord);
  }
}