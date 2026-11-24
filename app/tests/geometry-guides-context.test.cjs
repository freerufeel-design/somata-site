const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { declarations } = require('./helpers/source.cjs');

// Exercise the real capture-handler target resolver with the same nesting
// as index.html. A color input next to the guides button must not claim it.
class Element {
  constructor({id='',type='',classes=[],parent=null}={}) {
    Object.assign(this,{id,type,classes,parentElement:parent,children:[]});
    if(parent) parent.children.push(this);
  }
  matches(selector) {
    return selector.split(',').some(s => s.startsWith('#') ? this.id===s.slice(1)
      : s.startsWith('.') ? this.classes.includes(s.slice(1))
      : s==='input[type="color"]' ? this.type==='color' : false);
  }
  closest(selector) {return this.matches(selector)?this:this.parentElement?.closest(selector)??null;}
  querySelector(selector) {
    if(selector.includes('input[type="color"]')) {
      for(const child of this.children) {if(child.type==='color')return child;const nested=child.querySelector(selector);if(nested)return nested;}
    }
    return null;
  }
}
const find = vm.runInNewContext(`${declarations('findColorInputForContextTarget')}\nfindColorInputForContextTarget`,{Element});
test('global color capture leaves right-click on guides to the guides menu, but retains actual color controls',()=>{
  const bar = new Element({classes:['floating-display-controls']});
  const label = new Element({classes:['display-color-control'],parent:bar});
  const bg = new Element({type:'color',parent:label});
  const dot = new Element({parent:label});
  const button = new Element({id:'btnGeometryGuides',parent:bar});
  const icon = new Element({parent:button});
  new Element({id:'paramBoundingCircleColor',type:'color',parent:bar});
  assert.equal(find(button),null);
  assert.equal(find(icon),null);
  assert.equal(find(dot),bg);
  assert.equal(find(bg),bg);
  const menu = new Element({id:'geometryGuidesMenu'});
  const check = new Element({id:'testMorphSkeleton',type:'checkbox',parent:menu});
  const color = new Element({id:'paramRoundingGuideColor',type:'color',parent:menu});
  assert.equal(find(check),null);
  assert.equal(find(color),color);
});
