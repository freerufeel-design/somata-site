// Somata 13.0.13 — shared, engine-independent Morph parameter-row lifecycle.
// Every Morph row has two INDEPENDENT properties:
//   added: present in editor; active: changes scene during Morph.
// Checkbox toggles active only; × / catalog removal changes added.
// This module never knows the parameter id, or whether it is Blue/Orange.
(function(){
    'use strict';
    function isPresent(owner,kind,active){
        const val=owner?.[String(kind)+'Added'];
        return typeof val==='boolean'?val:active===true;
    }
    function setPresent(owner,kind,present){
        if(!owner||typeof owner!=='object')return false;
        owner[String(kind)+'Added']=present===true;
        return true;
    }
    function appendCheckbox(row,active,onChange,title='Включить / выключить параметр'){
        row.classList.toggle('disabled',active!==true);
        row.dataset.routeRowActive=active===true?'true':'false';
        const cb=document.createElement('input');
        cb.type='checkbox';cb.checked=active===true;cb.title=title;
        cb.addEventListener('change',()=>onChange(cb.checked));
        row.appendChild(cb);return cb;
    }
    window.SomataMorphRowLifecycle=Object.freeze({isPresent,setPresent,appendCheckbox});
})();
