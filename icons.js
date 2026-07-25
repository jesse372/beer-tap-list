/* Shared beer icons — used by both the TV screen (index.html) and the editor (edit.html).
   Each entry: [key, label, inner SVG].  All drawn on a 24x24 grid in currentColor. */
window.BEER_ICONS = [
  ["pint", "Pint glass",
    '<path d="M6.4 2.8h11.2l-1.35 17.4a1.6 1.6 0 0 1-1.6 1.5H9.35a1.6 1.6 0 0 1-1.6-1.5z"/>' +
    '<path d="M6.9 8.2h10.2"/>'],

  ["mug", "Beer mug",
    '<path d="M4.2 4.6h11.4v14.9a2 2 0 0 1-2 2H6.2a2 2 0 0 1-2-2z"/>' +
    '<path d="M15.6 8.4h2.2a3 3 0 0 1 0 6h-2.2"/>' +
    '<path d="M4.2 9.1h11.4"/>'],

  ["bottle", "Bottle",
    '<path d="M10 2.4h4v2.9c0 1 .3 1.6 1 2.3l.5.6c.6.7.9 1.5.9 2.4v9a2 2 0 0 1-2 2H9.6a2 2 0 0 1-2-2v-9c0-.9.3-1.7.9-2.4l.5-.6c.7-.7 1-1.3 1-2.3z"/>' +
    '<path d="M8.5 13.2h7"/>'],

  ["can", "Can",
    '<rect x="6.2" y="2.8" width="11.6" height="18.4" rx="2.1"/>' +
    '<path d="M6.5 6.3h11M6.5 17.7h11"/>'],

  ["hop", "Hop cone",
    '<path d="M12 2.6c3.1 2.1 5.1 4.7 5.1 8.2 0 4.6-2.6 8.2-5.1 10.3-2.5-2.1-5.1-5.7-5.1-10.3 0-3.5 2-6.1 5.1-8.2z"/>' +
    '<path d="M12 4.4v15.6"/>' +
    '<path d="M7.4 9.1c2.1 1.6 7.1 1.6 9.2 0M7.1 13.4c2.2 1.6 7.6 1.6 9.8 0"/>'],

  ["wheat", "Barley",
    '<path d="M12 21.4V8.2"/>' +
    '<path d="M12 8.2c0-2.4-1.2-3.9-3-4.5.3 2.4 1.2 3.9 3 4.5zM12 8.2c0-2.4 1.2-3.9 3-4.5-.3 2.4-1.2 3.9-3 4.5z"/>' +
    '<path d="M12 13.1c0-2.4-1.2-3.9-3-4.5.3 2.4 1.2 3.9 3 4.5zM12 13.1c0-2.4 1.2-3.9 3-4.5-.3 2.4-1.2 3.9-3 4.5z"/>' +
    '<path d="M12 18c0-2.4-1.2-3.9-3-4.5.3 2.4 1.2 3.9 3 4.5zM12 18c0-2.4 1.2-3.9 3-4.5-.3 2.4-1.2 3.9-3 4.5z"/>'],

  ["keg", "Keg",
    '<ellipse cx="12" cy="4.6" rx="5.2" ry="2.1"/>' +
    '<path d="M6.8 4.6v14.8M17.2 4.6v14.8"/>' +
    '<path d="M6.8 19.4a5.2 2.1 0 0 0 10.4 0"/>' +
    '<path d="M6.9 10.1h10.2M6.9 14.4h10.2"/>'],

  ["growler", "Growler",
    '<path d="M9.2 2.6h5.6v2.6l1.3 1.9c.5.8.8 1.6.8 2.5v10.3a2 2 0 0 1-2 2H9.1a2 2 0 0 1-2-2V9.6c0-.9.3-1.7.8-2.5l1.3-1.9z"/>' +
    '<path d="M16.9 10.4h1.6a2 2 0 0 1 2 2v1.7a2 2 0 0 1-2 2h-1.6"/>']
];

/* Build an <svg> string for a given icon key. Returns "" for none/unknown. */
window.beerIconSVG = function(key, extraClass){
  if(!key) return "";
  var list = window.BEER_ICONS, i;
  for(i = 0; i < list.length; i++){
    if(list[i][0] === key){
      return '<svg class="' + (extraClass || "") + '" viewBox="0 0 24 24" ' +
             'fill="none" stroke="currentColor" stroke-width="1.6" ' +
             'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
             list[i][2] + '</svg>';
    }
  }
  return "";
};
