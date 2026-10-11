// ========== GLOBAL VARIABLES & DEFAULTS ==========
/** WidgetSDK object 
 * @type WidgetSDK
*/
let W;
/** Translation function 
 * @type function
*/
let T;

/* Widget global variables */
const DEADLINE_PRIORITE = new Date('3000-01-01');
const BACKCOLOR = '#DCDCDC';
const TEXTCOLOR = '#000000';
let RECS;
let TAGSLIST = [];

// ========== INITILIZATION ==========
/** Asynchonous load of the widget */
window.addEventListener('load', async (event) => {
    /** Create widget manager object */
    W = new WidgetSDK();

    T = await W.loadTranslations(['widget.js']); 

    const lookup_details = `If empty, the widget use the column properties (based on choices or references) to make the list. Else, you can either:\n• Provides a list, separated by ";"\n• Provides a reference to a table or a column starting with a "$" ($TableID or $TableID.ColumnID)`;
    /** Configure options */
    W.configureOptions(
        [
            WidgetSDK.newItem('columns', null, 'Behavior',  'Configure the behavior of each columns', 'Columns',
                {
                    columnId:'STATUT',
                    template:[
                        WidgetSDK.newItem('addbutton', true, 'Can add card', 'If checked, display a button to add card to the column.'),
                        WidgetSDK.newItem('isdone',false,'Is done','If checked, cards in the columns are considered as over.'),
                        WidgetSDK.newItem('useconfetti',false,'Use confetti','If checked, confetti apprear when a card enter in the column.'),
                        WidgetSDK.newItem('hidecolumn',false,'Hide','If checked, the column is hidden.'),
                    ]
                }
            ),
            WidgetSDK.newItem('ref', '', 'References',  'List of task references available.', 'Cards options', 
                    {description:lookup_details, columnId:'REFERENCE_PROJET', type:'lookup'}),
            WidgetSDK.newItem('types', '', 'Type', 'List of task types available.', 'Cards options', 
                    {description:lookup_details, columnId:'TYPE', type:'lookup'}),
            WidgetSDK.newItem('incharge', '', 'In charge', 'List of people that can be in charge of the task.', 'Cards options', 
                    {description:lookup_details, columnId:'RESPONSABLE', type:'lookup'}),
            WidgetSDK.newItem('cardcolor', '', 'Card color', 'List of color available for card background.', 'Cards options', 
                {description:lookup_details, columnId:'COULEUR', type:'lookup'}),
            WidgetSDK.newItem('rotation', true, 'Tilt',  'If checked, cards are randomly tilted.', 'Display'),
            WidgetSDK.newItem('compact', false, 'Compact',  'If checked, use a compact rendering.', 'Display'),
            WidgetSDK.newItem('readonly', false, 'Read only', 'If checked, kanban is ready only.', 'Display'),
            WidgetSDK.newItem('hideedit', false, 'Hide editing form', 'If checked, hide the editing form when click on a card.', 'Display'),
            WidgetSDK.newItem('gristeditcard', false, 'Grist Record Card', 'If checked, opens the grist record card on double click.', 'Display'),
        ], 
        '#config-view', 
        '#main-view', 
        {onOptChange:optionsChanged, onOptLoad:optionsChanged} 
    );

    W.initMetaData();

    /** Initialize widget subscription to Grist */
    W.ready({
        requiredAccess: 'full', 
        allowSelectBy: true,
        columns: [
            // ИСПРАВЛЕНО: Изменен тип с 'Choice' на 'Choice,Ref', чтобы Grist разрешил привязать колонку связи
            {name:'STATUT', title:'Status', description:'Defines the Kanban column', type:'Choice,Ref', strictType:false},
            {name:'DESCRIPTION', title:'Task', description:'Task name', type:'Any'}, 
            {name:'DESCRIPTION_DISPLAY', title:'Task Display', description:'Displayed card content (e.g. a formula column adding html)', type:'Any', optional:true}, 
            {name:'DEADLINE', title:'Deadline', description:'Can also be use as priority', type:'Date', optional:true},             
            {name:'REFERENCE_PROJET', title:'Reference', description:'Reference associated with the task', type:'Any', optional:true},
            {name:'TYPE', title:'Type', description:'Type associated with the task', type:'Any', optional:true},              
            {name:'RESPONSABLE', title:'In charge', description:'Who is in charge', type:'Any', optional:true}, 
            {name:'CREE_PAR', title:'Created by', type:'Any', optional:true}, 
            {name:'CREE_LE', title:'Creation date', type:'DateTime', optional:true}, 
            {name:'DERNIERE_MISE_A_JOUR', title:'Last update date', description:'Updated after any change', type:'DateTime', optional:true},
            {name:'NOTES', title:'Notes', description:'Additional notes', type:'Any', optional:true},
            {name:'COULEUR', title:'Card color', description:'Choice or html value', type:'Choice,Text', optional:true},
            {name:'TAGS', title:'Tags', description:'Additional fields to display', type:'Any', optional:true, allowMultiple:true}
        ],
    });

    W.onRecords(afficherKanban, {expandRefs:true, keepEncoded:false, mapRef:true});

    W.isLoaded().then(async () => {
        W.initDone = true;
    });

    grist.on('message', async (e) => {
        if (e.mappingsChange) mappingChanged();
    });
});

// ========== WIDGET MANAGEMENT ==========
async function afficherKanban(recs) {
    RECS = recs;

    const conteneurKanban = document.getElementById('conteneur-kanban');
    conteneurKanban.innerHTML = '';

    const colonnes = await W.col.STATUT.getChoices();
    if (!colonnes || colonnes.length === 0) {
        console.error(T('No choice available in the Status column'));
        return;
    }

    let newcol;
    colonnes.forEach((col, idx) => {
        newcol = creerColonneKanban(col, idx);
        if (newcol != null) conteneurKanban.appendChild(newcol);
    });

    if (recs?.length > 0) {
        recs.forEach( todo => {
            // ИСПРАВЛЕНО: Если STATUT это объект связи (Ref), берем отображаемое текстовое значение (label), иначе — саму строку
            const статусЗначение = (todo.STATUT && typeof todo.STATUT === 'object') ? todo.STATUT.label : todo.STATUT;
            
            const carte = creerCarteTodo(todo);
            const col = document.querySelector(`.contenu-colonne[data-statut="${статусЗначение}"]`);
            if (col) {
              col.insertBefore(carte, col.firstChild);
            }
          });

        if(!W.opt.readonly) {
            document.querySelectorAll('.contenu-colonne').forEach(colonne => {
                new Sortable(colonne, {
                    group: 'kanban-todo',
                    animation: 150,
                    onEnd: async function(evt) {
                        const colonneArrivee = evt.to.dataset.statut;
                        if (colonneArrivee === evt.from.dataset.statut) {
                            if (W.map.DEADLINE) { 
                                let deadline = evt.item.dataset.deadline || '9999-12-31';

                                if (evt.oldIndex !== evt.newIndex && (new Date(deadline)) >= DEADLINE_PRIORITE) {
                                    let start = DEADLINE_PRIORITE.getFullYear();              
                                    let data = [];
                                    document.querySelectorAll('.contenu-colonne').forEach(colonne => { 
                                        if (colonne.getAttribute('data-statut') === colonneArrivee) {
                                            colonne.querySelectorAll('.carte').forEach(async carte => { 
                                                deadline = carte.getAttribute('data-deadline') || '9999-12-31';
                                                if ((new Date(deadline)) >= DEADLINE_PRIORITE) {
                                                    deadline = `${start}-01-01`;
                                                    carte.setAttribute('data-deadline', deadline);
                                                    start += 1;
                                                
                                                    data.push(W.formatRecord(carte.getAttribute('data-todo-id'), {DEADLINE: deadline}));
                                                }
                                            });
                                        }
                                    }); 
                                    
                                    try {
                                        await W.updateRecords(data);
                                    } catch (erreur) {
                                        console.error(T('Error during status update:'), erreur);
                                    }
                                }   
                            }                                         
                        } else {
                            try {
                                // ИСПРАВЛЕНО: При перемещении карточки в случае колонки Ref нам нужно передать ID записи из выпадающего списка
                                let значениеДляЗаписи = colonneArrivee;
                                if (W.col.STATUT.type.startsWith('Ref')) {
                                    // Ищем оригинальный ID записи среди доступных вариантов связи
                                    const choicesWithId = await W.col.STATUT.getChoices(); 
                                    // Попытка найти соответствие по тексту, чтобы вытащить ID для сохранения
                                    const найденныйВариант = RECS.find(r => r.STATUT && r.STATUT.label === colonneArrivee);
                                    if (найденныйВариант && найденныйВариант.STATUT) {
                                        значениеДляЗаписи = найденныйВариант.STATUT.id;
                                    }
                                }
                                await mettreAJourChamp(evt.item.dataset.todoId, 'STATUT', значениеДляЗаписи);
                            } catch (erreur) {
                                console.error(T('Error during status update:'), erreur);
                            }
                        } 
                        trierTodo(colonne);
                    }
                });
                trierTodo(colonne);
              });
        }
        document.querySelectorAll('.colonne-kanban').forEach(mettreAJourCompteur);
    }
}

async function optionsChanged(opts) {    
    await W.isMapped();
    afficherKanban(RECS);
}

// ========== CRÉATION DES CARTES ET COLONNES ==========
function creerColonneKanban(colonne, idx) {
    const opt = W.opt.columns[idx];
    if (!opt || opt.hidecolumn) return null;

    const colonneElement = document.createElement('div');
    colonneElement.className = `colonne-kanban${(!opt.addbutton && !W.opt.compact)? ' colonne-nobouton':''}`; 
    colonneElement.id = colonne;
    
    const savedState = localStorage.getItem(`column-todo-${colonne}`); 
    if (savedState === 'true') {
        colonneElement.classList.add('collapsed');
    }

    colonneElement.innerHTML = `
        <div class="entete-colonne" style="background-color: ${W.col.STATUT.getColor(colonne) ?? BACKCOLOR};color:${W.col.STATUT.getTextColor(colonne) ?? TEXTCOLOR}">
            <div class="titre-statut">${colonne} <span class="compteur-colonne">(0)</span></div>
            ${(opt.addbutton && !W.opt.readonly) ? `
            <button class="bouton-ajouter-entete ${W.opt.compact ? ' compact': ''}" onclick="creerNouvelleTache('${colonne}')">+</button>
            ` : ''}
            <button class="bouton-toggle" onclick="toggleColonne(this.closest('.colonne-kanban'), event)">⇄</button>
        </div>
        ${(opt.addbutton && !W.opt.readonly) ? `
            <button class="bouton-ajouter ${W.opt.compact ? ' compact': ''}" onclick="creerNouvelleTache('${colonne}')">+ ${T('Add a new task')}</button>
        ` : ''}
        <div class="contenu-colonne" data-statut="${colonne}"></div>
    `;
  
    return colonneElement;
}

function mappingChanged() {
    const colonnes = document.getElementsByClassName('colonne-kanban');
    Array.prototype.forEach.call(colonnes, col => {
        col.style = `background-color: ${W.col.STATUT.getColor(col.id) ?? BACKCOLOR};color:${W.col.STATUT.getTextColor(col.id) ?? TEXTCOLOR}`;
    });
    updateTagsList();    
}

async function updateTagsList() {
    await W.isMapped();
    TAGSLIST = [];
    if (W.map.TAGS) {
        TAGSLIST = W.map.TAGS.map(async t => {
            const cmeta = await W.meta.getColMeta(t);
            return await cmeta?.getChoices() ?? [];
        });
        TAGSLIST = await Promise.all(TAGSLIST);
    }
}

function creerCarteTodo(todo) { 
    const carte = document.createElement('div');
    carte.className =`carte ${W.opt.rotation ? '': ' norotate'}${W.opt.compact ? ' compact': ''}`;
    
    carte.setAttribute('data-todo-id', todo.id);
    carte.setAttribute('data-last-update', todo.DERNIERE_MISE_A_JOUR || '');
    carte.setAttribute('data-deadline', todo.DEADLINE || '');
    if (todo.COULEUR) {
        if (W.col.COULEUR.type === 'Choice')
            if (W.col.COULEUR.getColor(todo.COULEUR)) carte.setAttribute('style', `background-color: ${W.col.COULEUR.getColor(todo.COULEUR)}`);
        else
            carte.setAttribute('style', `background-color: ${(todo.COULEUR.startsWith("#")? '': '#') + todo.COULEUR}`);        
    }

    const type = todo.TYPE || '';
    const description = todo.DESCRIPTION_DISPLAY || todo.DESCRIPTION || T('No description');
    const deadline = todo.DEADLINE ? formatDate(todo.DEADLINE) : '';
    const responsable = todo.RESPONSABLE || '';
    const projetRef = todo.REFERENCE_PROJET;
    const tags = todo.TAGS || [];

    let taglist= '';
    tags.forEach(t => taglist += t?`<div class="more-tag">${t}</div>`:'');
    
    // ИСПРАВЛЕНО: Корректное чтение статуса для выгрузки опций отображения колонок
    const статусТекст = (todo.STATUT && typeof todo.STATUT === 'object') ? todo.STATUT.label : todo.STATUT;
    const infoColonne = W.getValueListOption('columns', статусТекст);

    carte.innerHTML = `
        ${projetRef && projetRef.length > 0 ? `<div class="projet-ref truncate">#${projetRef}</div>` : ''}
        ${type ? `<div class="type-tag truncate">${type}</div>` : (projetRef && projetRef.length > 0 ? '<div>&nbsp;</div>':'')}
        ${tags.length > 0 ? `<div>${taglist}</div>`:''}
        <div class="description">${description}</div>
        ${deadline ? `<div class="deadline${todo.DEADLINE < Date.now() ? ' late':''} truncate">📅 ${deadline}</div>` : (responsable ? '<div>&nbsp;</div>':'')}
        ${responsable ? `<div class="responsable-badge truncate">${responsable}</div>` : ''}
        ${infoColonne?.isdone ? `<div class="tampon-termine" style="color: ${W.col.STATUT.getColor(статусТекст) ?? BACKCOLOR};">${статусТекст}</div>` : ''}      
    `;
  
    carte.addEventListener('click', () => {
        grist.setCursorPos({rowId: todo.id});
        if(!W.opt.hideedit) togglePopupTodo(todo);
    });
    
    carte.addEventListener('dblclick', () => {
        grist.setCursorPos({rowId: todo.id});
        if(W.opt.gristeditcard) grist.commandApi.run('viewAsCard');
        else if(!W.opt.hideedit) togglePopupTodo(todo);
    });
    return carte;
}

async function mettreAJourChamp(todoId, champ, valeur, e) {
    try {
        e?.stopPropagation();
        if (champ === 'STATUT') {
            const infoColonne = W.getValueListOption('columns', valeur); 
            if (infoColonne && infoColonne.useconfetti)
                triggerConfetti();
        }
        let data = {[champ]: valeur ? valeur : undefined};
        if (W.map.DERNIERE_MISE_A_JOUR) data.DERNIERE_MISE_A_JOUR = new Date().toISOString();

        await W.updateRecords(W.formatRecord(todoId, data));
    } catch (erreur) {
        console.error(T('Error during update:'), erreur);
    }
}

function trierTodo(conteneur) { 
    const cartes = Array.from(conteneur.children);
    const colonne = conteneur.dataset.isdone;
    
    cartes.sort((a, b) => {
        let delta = 0;
        if (W.map.DEADLINE) {
            if (colonne) {
                const dateA = a.getAttribute('data-last-update') || '1970-01-01';
                const dateB = b.getAttribute('data-last-update') || '1970-01-01';
                delta = new Date(dateB) - new Date(dateA);            
            } else {
                const dateA = a.getAttribute('data-deadline') || '9999-12-31';
                const dateB = b.getAttribute('data-deadline') || '9999-12-31';
                delta = new Date(dateA) - new Date(dateB); 
            }
        }        

        if (delta === 0) {
            const idA = parseInt(a.getAttribute('data-todo-id')) || 0;
            const idB = parseInt(b.getAttribute('data-todo-id')) || 0;
            return idA - idB;
        }
        else 
            return delta; 
    });
    
    cartes.forEach(carte => conteneur.appendChild(carte));
}

function mettreAJourCompteur(colonne) {
    const contenu = colonne.querySelector('.contenu-colonne');
    const compteur = colonne.querySelector('.compteur-colonne');
    if (contenu && compteur) {
        compteur.textContent = `(${contenu.children.length})`;
    }
}

// ========== GESTION DU POPUP ==========
function togglePopupTodo(todo) {
    const popup = document.getElementById('popup-todo');
    const carteActive = document.querySelector('.carte.active');
    const carteCliquee = document.querySelector(`[data-todo-id="${todo.id}"]`);
    
    // ИСПРАВЛЕНО: Получение текстового названия статуса для открытия карточки
    const статусТекст = (todo.STATUT && typeof todo.STATUT === 'object') ? todo.STATUT.label : todo.STATUT;
    const infoColonne = W.getValueListOption('columns', статусТекст);

    if (W.opt.readonly) { 
        fermerPopup();
        return;
    }

    carteActive?.classList.remove('active');
    carteCliquee?.classList.add('active');

    popup.style = `border-left-color: ${W.col.STATUT.getColor(статусТекст) ?? BACKCOLOR}`;

    popup.dataset.statut = статусТекст;
    popup.dataset.isdone = infoColonne? false : infoColonne.isdone;
    popup.dataset.currentTodo = todo.id;
    
    const popupTitle = popup.querySelector('.popup-title');
    const content = popup.querySelector('.popup-content');
    const popupheader = popup.querySelector('.popup-header');
    popupheader.style = `background-color: ${W.col.STATUT.getColor(статусТекст) ?? BACKCOLOR};color:${W.col.STATUT.getTextColor(статусТекст) ?? TEXTCOLOR}`;
    const popupclose = popup.querySelector('.bouton-fermer');
    popupclose.style =  `color:${W.col.STATUT.getTextColor(статусТекст) ?? TEXTCOLOR}`;
    
    popupTitle.textContent = todo.DESCRIPTION || T('New task');

    let count = 1;
    let form = '<div class="field-row">';
    if (W.map.DEADLINE) {
        form += `
            <div class="field">
            <label class="field-label">${W.map.DEADLINE}</label>
            <input type="date" class="field-input" 
                    value="${formatDateForInput(todo.DEADLINE)}"
                    onchange="mettreAJourChamp(${todo.id}, 'DEADLINE', this.value, event)">
            </div>
        `;
    }    

    if (W.map.REFERENCE_PROJET) {
        form += insererChamp(todo.id, todo.REFERENCE_PROJET, W.valuesList.ref, W.map.REFERENCE_PROJET, 'REFERENCE_PROJET', W.col.REFERENCE_PROJET.getIsFormula()); 
        count += 1;
    }
    if (count % 2 === 0) form += `</div><div class="field-row">`;
    if (W.map.TYPE) {
        form += insererChamp(todo.id, todo.TYPE, W.valuesList.types, W.map.TYPE, 'TYPE', W.col.TYPE.getIsFormula());
        count += 1; 
    }
    if (count % 2 === 0) form += `</div><div class="field-row">`;
    if (W.map.RESPONSABLE) {
        form += insererChamp(todo.id, todo.RESPONSABLE, W.valuesList.incharge, W.map.RESPONSABLE, 'RESPONSABLE', W.col.RESPONSABLE.getIsFormula());
        count += 1;   
    }
    if (count % 2 === 0) form += `</div><div class="field-row">`;
    if (W.map.TAGS) {
        W.map.TAGS.forEach((t, i) => {
            form += insererChamp(todo.id, todo.TAGS[i], TAGSLIST[i], t, t, W.col.TAGS[i].getIsFormula());
            count += 1;
            if (count % 2 === 0) form += `</div><div class="field-row">`;
        });
    }
    if (W.map.COULEUR) {
        form += insererChamp(todo.id, todo.COULEUR, W.valuesList.cardcolor, W.map.COULEUR, 'COULEUR', W.col.COULEUR.getIsFormula());
        count += 1;   
    }

    form += `</div>
        <div class="field">
            <label class="field-label">${W.map.DESCRIPTION}</label>
            <textarea class="field-textarea auto-expand" 
                    onchange="mettreAJourChamp(${todo.id}, 'DESCRIPTION', this.value, event)"
                    oninput="this.style.height = ''; this.style.height = this.scrollHeight + 'px'">${todo.DESCRIPTION || ''}</textarea>
        </div>
    `;
    if (W.map.NOTES) {
        form += `<div class="field">
            <label class="field-label">${W.map.NOTES}</label>
            <textarea class="field-textarea auto-expand" 
                      onchange="mettreAJourChamp(${todo.id}, 'NOTES', this.value, event)"
                      oninput="this.style.height = ''; this.style.height = this.scrollHeight + 'px'">${todo.NOTES || ''}</textarea>
          </div>
        `;
    }
    if ((W.map.CREE_LE && todo.CREE_LE) || (W.map.CREE_PAR && todo.CREE_PAR) || (W.map.DERNIERE_MISE_A_JOUR && todo.DERNIERE_MISE_A_JOUR)) {
        form += `<div class="info-creation">
                ${T('Created')} ${(W.map.CREE_LE && todo.CREE_LE) ? T('on %on', {on:formatDate(todo.CREE_LE)}): ''} 
                ${(W.map.CREE_PAR && todo.CREE_PAR) ? T('by %by', {by:(todo.CREE_PAR || '-')}): ''}
                ${(W.map.DERNIERE_MISE_A_JOUR && todo.DERNIERE_MISE_A_JOUR) ? ('<br>' + T('Last update on %on', {on:(formatDate(todo.DERNIERE_MISE_A_JOUR) || '-')})): ''}
            </div>
        `;
    }

    if (!W.opt.readonly) {
        form += ` 
          <div class="popup-actions">
            <button class="popup-action-button bouton-supprimer" onclick="supprimerTodo(${todo.id}, event)" 
                    title="${T('Remove the task')}">🗑️</button>
          </div>
        `;
    }
    content.innerHTML = form;

    setTimeout(() => {
        const textareas = document.querySelectorAll('.auto-expand');
        textareas.forEach(textarea =>    {
            textarea.style.height = '';
            textarea.style.height = textarea.scrollHeight + 'px';
        });
    }, 0);
    
    popup.classList.add('visible');
}

function insererChamp(id, value, list, title, col, disable) {
    let form='';
    if (list?.length > 0) {
        if( list.length < 10) {
            form += `
                <div class="field">
                    <label class="field-label">${title}</label>
                    <select class="field-select" onchange="mettreAJourChamp(${id}, '${col}', this.value, event)">
                    <option value="" ${disable?"disabled":""}></option>`;
            list.forEach(element => {
                form += `<option value="${element}" ${value === element ? 'selected' : ''}>${element}</option>`;  
            });
            form += `</select>
                </div>        
            `;
        } else {
            form += `
                <div class="field">
                    <label class="field-label">${title}</label>
                    <input type="text" list="list-${col}" class="field-select" onchange="mettreAJourChamp(${id}, '${col}', this.value, event)" ${disable?"disabled":""}/>
                    <datalist id="list-${col}">`;
            list.forEach(element => {
                form += `<option value="${element}" ${value === element ? 'selected' : ''}>${element}</option>`;  
            });
            form += `</datalist>
                </div>        
            `;
        }
    } else {
        form += `
            <div class="field">
                <label class="field-label">${title}</label>
                <input type="text" class="field-input" value="${value || ''}" 
                    onchange="mettreAJourChamp(${id}, '${col}', this.value, event)" ${disable?"disabled":""}>
            </div>
        `;
    }
    return form;
}

function fermerPopup() {
    const popup = document.getElementById('popup-todo');
    const todoId = popup.dataset.currentTodo;
    const carteActive = document.querySelector(`[data-todo-id="${todoId}"]`);
    if (carteActive) {
        carteActive.classList.remove('active');
    }
    popup.classList.remove('visible');
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        fermerPopup();
    }
});
  
document.addEventListener('click', (e) => {
    const popup = document.getElementById('popup-todo');
    if (popup.classList.contains('visible')) {
        const popupContent = popup.querySelector('.popup-content');
        if (!popupContent.contains(e.target) && !e.target.closest('.carte') && !e.target.closest('.popup-header')) {
            fermerPopup();
        }
    }
});

// ========== GESTION DES TÂCHES ==========
async function creerNouvelleTache(colonneId) {
    try {
        let data = {DESCRIPTION: '', STATUT: colonneId};
        if (W.map.TYPE && !W.col.TYPE.getIsFormula()) data.TYPE = '';
        if (W.map.REFERENCE_PROJET && !W.col.REFERENCE_PROJET.getIsFormula()) data.REFERENCE_PROJET = null;
        if (W.map.DERNIERE_MISE_A_JOUR && !W.col.DERNIERE_MISE_A_JOUR.getIsFormula()) data.DERNIERE_MISE_A_JOUR = new Date().toISOString();
        if (W.map.CREE_LE && !W.col.CREE_LE.getIsFormula()) data.CREE_LE = new Date().toISOString();

        const res = await W.createRecords({fields: data});
        if (res.id && res.id > 0) {
            const rec = await W.fetchSelectedRecord(res.id);
            grist.setCursorPos({rowId: res.id});
            if(!W.opt.hideedit) togglePopupTodo(rec);
        }
    } catch (erreur) {
            console.error(T('Error on creation:'), erreur);
    }
}

async function supprimerTodo(todoId, e) {
    e?.stopPropagation();
    if (confirm(T('Are you sure you want to delete this task?'))) {
        try {
            await W.destroyRecords(todoId);
            fermerPopup();
        } catch (erreur) {
            console.error(T('Error on delete:'), erreur);
        }
    }
}

// ========== HELPERS ==========
function toggleColonne(colonne, e) {
    e?.stopPropagation();
    colonne.classList.toggle('collapsed');
    localStorage.setItem(`column-todo-${colonne.querySelector('.titre-statut').textContent.trim()}`, colonne.classList.contains('collapsed'));
}
  
function triggerConfetti() {
    const duration = 2 * 1000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0 };

    function randomInRange(min, max) {
        return Math.random() * (max - min) + min;
    }

    const interval = setInterval(function() {
        const timeLeft = animationEnd - Date.now();

        if (timeLeft <= 0) {
            return clearInterval(interval);
        }

        const particleCount = 50 * (timeLeft / duration);
        
        confetti(Object.assign({}, defaults, {
            particleCount,
            origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 }
        }));
        confetti(Object.assign({}, defaults, {
            particleCount,
            origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 }
        }));
    }, 250);
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    if (date >= DEADLINE_PRIORITE) return null;

    const day = date.getDate().toString().padStart(2, '0');
    const month = date.toLocaleDateString(W.cultureFull, { month: 'short' });
    const year = date.getFullYear();
    return `${day} ${month} ${year}`;
}

function formatDateForInput(dateStr) {
    if (!dateStr) return '';
    try {
        const date = new Date(dateStr);
        if (date >= DEADLINE_PRIORITE)
            return '';
        else 
            return date.toISOString().split('T')[0];
    } catch (e) {
        console.error(T('Error on date formating:'), e);
        return '';
    }
}

// ========== EXPORT DES FONCTIONS GLOBALES ==========
window.toggleColonne = toggleColonne;
window.togglePopupTodo = togglePopupTodo;
window.fermerPopup = fermerPopup;
window.mettreAJourChamp = mettreAJourChamp;
window.creerNouvelleTache = creerNouvelleTache;
window.supprimerTodo = supprimerTodo;