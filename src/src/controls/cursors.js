/*
 * custom cursors that are defined in CSS properties that are named
 * '--cursor-[keyword]' with keyword according to
 * https://developer.mozilla.org/en-US/docs/Web/CSS/cursor
 */

/*
 * list of cursor availability, will be populated on requests
 */
const availableCursors = {};

/*
 * keywords that are available here but not in CSS standard,
 * name always starts with a legit css cursor keyword followed by '-'
 */
const nonStandardCursors = [
  'default-color', 'default-history', 'default-template',
  'default-color-on', 'default-history-on', 'default-template-on',
  'move-color', 'move-history', 'move-template',
];

/*
 * set cursor for an element according to keyword
 */
export function setCursor(keyword, element, custom = true) {
  if (!element) {
    element = document.body;
  }
  const propertyName = `--cursor-${keyword}`;
  let cursorIsCustom;
  if (!custom) {
    cursorIsCustom = false;
  } else if (keyword in availableCursors) {
    cursorIsCustom = availableCursors[keyword];
  } else {
    cursorIsCustom = !!getComputedStyle(document.documentElement)
      .getPropertyValue(propertyName);
    availableCursors[keyword] = cursorIsCustom;
  }
  let cursorCss;
  if (cursorIsCustom) {
    cursorCss = `var(${propertyName})`;
  } else if (nonStandardCursors.includes(keyword)) {
    cursorCss = keyword.substring(0, keyword.indexOf('-'));
  } else {
    cursorCss = keyword;
  }
  element.style.cursor = cursorCss;
}

export function getCursor(element) {
  if (!element) {
    element = document.body;
  }
  let { cursor } = element.style;
  if (!cursor) return 'default';
  let indexVar = cursor.indexOf('var(');
  if (indexVar !== -1) {
    // 'var(--cursor-'
    indexVar += 13;
    cursor = cursor.substring(indexVar, cursor.indexOf(')', indexVar));
    if (nonStandardCursors.includes(cursor)) {
      cursor = cursor.substring(0, cursor.indexOf('-'));
    }
  }
  return cursor;
}

export function resetCursor(element) {
  if (!element) {
    element = document.body;
  }
  element.style.cursor = 'auto';
}
