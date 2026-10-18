/*
 * Menu with Buttons on the top left
 *
 */

import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { Fragment } from 'preact';
import { memo } from 'preact/compat';
import { useStore } from '../../store/react-redux/index.js';

import { useConditionalClickOutside } from '../hooks/clickOutside.js';
import useLink from '../hooks/link.js';
import mainMenu from './mainMenu.js';
import userContextMenu from './userContextMenu.js';
import channelContextMenu from './channelContextMenu.js';
import banMediaContextMenu from './banMediaContextMenu.js';
import { clamp } from '../../core/utils.js';


/**
 * replace element within nested elements array, also reset all 'confirm'
 * type elements
 */
function replaceElement(elements, element) {
  const newElements = [];
  let found = false;
  for (let i = 0; i < elements.length; i += 1) {
    const rElement = elements[i];

    if (rElement.id === element.id) {
      found = true;
      newElements.push(element);
    } else if (rElement.type === 'confirm' && rElement.state) {
      newElements.push({
        ...rElement,
        state: false,
      });
    } else if (rElement.type === 'submenu') {
      const newRElement = replaceElement(elements[i], element);
      if (newRElement !== rElement) {
        found = true;
      }
      newElements.push(newRElement);
    } else {
      newElements.push(rElement);
    }
  }
  if (found) {
    return newElements;
  }
  return elements;
}


const MenuList = ({
  id, elements, x, y, align, isOpen, close, onClick, wrapperRef, className,
}) => {
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [doRender, setDoRender] = useState(false);
  /*
   * wheter or not a submenu is shown
   * active:
   *   defined: show
   *   false: show and tell child to animate the closure
   *   true: show
   * {
   *   [index]: { active, x, y }
   * }
   */
  const [childrenStates, setChildrenStates] = useState({});

  const style = {
    width: (className === 'MAIN') ? 152 : 125,
  };
  switch (align) {
    case 'tr': {
      style.right = window.innerWidth - x;
      style.top = y;
      break;
    }
    case 'br': {
      style.right = window.innerWidth - x;
      style.bottom = window.innerHeight - y;
      break;
    }
    case 'bl': {
      style.left = x;
      style.bottom = window.innerHeight - y;
      break;
    }
    default: {
      // also 'tl'
      style.left = x;
      style.top = y;
    }
  }

  if (style.right) {
    style.right = clamp(style.right, 0, window.innerWidth - style.width);
  } else if (style.left) {
    style.left = clamp(style.left, 0, window.innerWidth - style.width);
  }

  /*
   * we try to predict the resulting height, so a hardcoded row height value it
   * is, and then move the menu up / down accordingly
   */
  const predictedHeight = elements.length * 37;
  if (predictedHeight > window.innerHeight) {
    style.maxHeight = window.innerHeight - 20;
    style.overflow = 'auto';
    if (style.top) {
      style.top = 10;
    } else {
      style.bottom = 10;
    }
  } else if (style.top) {
    if (style.top < 0) {
      style.top = 0;
    }
    const gap = window.innerHeight - style.top - predictedHeight;
    if (gap < 0) {
      style.top += gap;
    }
  } else {
    if (style.bottom < 0) {
      style.bottom = 0;
    }
    const gap = window.innerHeight - style.bottom - predictedHeight;
    if (gap < 0) {
      style.bottom += gap;
    }
  }

  /*
   * remove a child after it got closed (transition ended within child)
   */
  const closeChild = useCallback((childId) => {
    setChildrenStates((oldState) => {
      const newState = { ...oldState };
      delete newState[childId];
      return newState;
    });
  }, []);

  /**
   * select an element, open submenu and close others if needed
   */
  const changeChildActive = useCallback((evt, childId, isSubMenu) => {
    const rect = evt.currentTarget.getBoundingClientRect();

    setSelectedEntry(childId);
    setChildrenStates((oldState) => {
      const newState = {};

      if (isSubMenu) {
        newState[childId] = {
          active: true,
          x: rect.right + window.scrollX,
          y: rect.top + window.scrollY,
        };
      }

      for (const [prevChildId, state] of Object.entries(oldState)) {
        if (prevChildId !== childId) {
          if (state.active) {
            newState[prevChildId] = { ...state, active: false };
          } else {
            newState[prevChildId] = state;
          }
        }
      }
      return newState;
    });
  }, []);

  const setAllChildrenInactive = useCallback(() => {
    setSelectedEntry(null);
    setChildrenStates((oldState) => {
      const newState = {};
      for (const [prevChildId, state] of Object.entries(oldState)) {
        if (state.active) {
          newState[prevChildId] = { ...state, active: false };
        } else {
          newState[prevChildId] = state;
        }
      }
      return newState;
    });
  }, []);

  useEffect(() => {
    if (isOpen && !doRender) {
      requestAnimationFrame(() => {
        setDoRender(true);
      });
    } else if (!isOpen && !doRender) {
      /*
       * when quickly clicking on/off before transition finished,
       * we could enter an irrecoverable state, make sure we remove in such
       * an event
       */
      close(id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, doRender]);

  let menuClassName = 'menu';
  if (className) {
    menuClassName += ` ${className}`;
  }
  if (isOpen && doRender) {
    menuClassName += ' show';
  }

  return (
    <div
      className={menuClassName}
      style={style}
      ref={wrapperRef}
      onTransitionEnd={isOpen ? undefined : () => close(id)}
    >
      {elements.map((element) => {
        const { id: childId } = element;
        let elementClassName = 'menuelement';
        if (selectedEntry === childId) {
          elementClassName += ' selected';
        }


        const text = (
          <>
            <span className="menuicon">
              {element.symbol && (<element.symbol />)}
            </span>
            <span className="menutext">{element.text}</span>
          </>
        );

        switch (element.type) {
          case 'func':
          case 'link':
            return (
              <div
                key={childId}
                className={elementClassName}
                onClick={() => onClick(element)}
                title={element.text}
                role="button"
                tabIndex={0}
                onMouseEnter={(evt) => changeChildActive(evt, childId)}
              >
                {text}
              </div>
            );
          case 'boolean':
            return (
              <div
                key={childId}
                className={elementClassName}
                title={element.text}
                role="button"
                tabIndex={0}
                onClick={() => onClick(element)}
                onMouseEnter={(evt) => changeChildActive(evt, childId)}
              >
                <span className="menuicon">
                  <input
                    type="checkbox"
                    checked={element.state}
                    onChange={(evt) => {
                      evt.stopPropagation();
                      onClick(element);
                    }}
                  />
                </span><span className="menutext">{element.text}</span>
              </div>
            );
          case 'confirm':
            return (
              <div
                key={childId}
                className={
                  elementClassName + ((element.state) ? ' confirm' : '')
                }
                style={
                  (element.state) ? { backgroundColor: 'red' } : undefined
                }
                title={element.text}
                role="button"
                tabIndex={0}
                onClick={() => onClick(element)}
                onMouseEnter={(evt) => changeChildActive(evt, childId)}
              >
                {text}
              </div>
            );
          case 'spacer':
            return (
              <div
                key={childId}
                className="menuspacer"
              />
            );
          case 'submenu': {
            const childState = childrenStates[childId];
            if (childId === 'ca') return null;
            return (
              <Fragment key={childId}>
                <div
                  className={elementClassName}
                  title={element.text}
                  role="button"
                  tabIndex={0}
                  onMouseEnter={(evt) => {
                    changeChildActive(evt, childId, true);
                  }}
                  onClick={(evt) => {
                    if (selectedEntry === childId) {
                      setAllChildrenInactive();
                    } else {
                      changeChildActive(evt, childId, true);
                    }
                  }}
                >
                  {text}
                  <span className="expand-btn">▶</span>
                </div>
                {(childState) && (
                  <MenuList
                    id={childId}
                    elements={element.elements}
                    isOpen={childState.active}
                    x={childState.x}
                    y={childState.y}
                    close={closeChild}
                    onClick={onClick}
                    className={className}
                  />
                )}
              </Fragment>
            );
          }
          default:
            return null;
        }
      })}
    </div>
  );
};


const Menu = ({ type, x, y, args, align, isOpen, remove, close }) => {
  const store = useStore();

  const getElementsFromProps = () => {
    let newElements;
    switch (type) {
      case 'MAIN':
        newElements = mainMenu(store);
        break;
      case 'USER':
        newElements = userContextMenu(store, args);
        break;
      case 'CHANNEL':
        newElements = channelContextMenu(store, args);
        break;
      case 'BANMEDIA':
        newElements = banMediaContextMenu(store, args);
        break;
      default:
        newElements = [];
    }
    return newElements;
  };

  const [elements, setElements] = useState(getElementsFromProps);
  const wrapperRef = useRef(null);
  /*
   * ref to remember which button we already pressed while it is being
   * processed, to avoid double clicks
   */
  const processStateRef = useRef({});

  const link = useLink();

  /*
   * This pattern is recommended by react-docs instead of setting state in a
   * useEffect.
   * It doesn't appear much better to me... we share a second render (with the
   * first one being with an empty array) with two new states and confusing
   * logic without clear intent.
   */
  const [prevType, setPrevType] = useState(type);
  const [prevArgs, setPrevArgs] = useState(args);
  if (prevType !== type || prevArgs !== args) {
    setPrevType(type);
    setPrevArgs(args);
    setElements(getElementsFromProps());
  }

  const onClick = useCallback(async (element) => {
    const elementId = element.id;
    const processing = processStateRef.current[elementId];
    if (processing) {
      return;
    }
    processStateRef.current[elementId] = true;

    try {
      switch (element.type) {
        case 'link': {
          link(element.link, {
            target: element.target || 'parent',
            reuse: element.reuse,
            args: element.args,
          });
          break;
        }
        case 'func': {
          await element.func();
          break;
        }
        case 'boolean': {
          const { state } = element;
          const success = await element.func(state);
          if (success) {
            setElements((oldElements) => replaceElement(oldElements, {
              ...element,
              state: !state,
            }));
          }
          return;
        }
        case 'confirm': {
          const { state } = element;
          if (!state) {
            setElements((oldElements) => replaceElement(oldElements, {
              ...element,
              state: true,
            }));
            return;
          }
          await element.func();

          break;
        }
        default:
          // nothing
      }
    } catch (err) {
      console.error(err);
    } finally {
      delete processStateRef.current[elementId];
    }

    remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useConditionalClickOutside(
    [wrapperRef],
    isOpen,
    remove,
  );

  return (
    <MenuList
      x={x}
      y={y}
      align={align}
      isOpen={isOpen}
      close={close}
      elements={elements}
      onClick={onClick}
      wrapperRef={wrapperRef}
      className={type}
    />
  );
};

export default memo(Menu);
