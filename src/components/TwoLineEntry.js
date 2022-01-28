// Copyright (c) Microsoft Corporation and others. Licensed under the MIT license.
// SPDX-License-Identifier: MIT

import React from 'react'
import PropTypes from 'prop-types'

export default class TwoLineEntry extends React.Component {
  static propTypes = {
    buttons: PropTypes.element,
    image: PropTypes.string,
    letter: PropTypes.string,
    headline: PropTypes.element,
    message: PropTypes.element,
    onClick: PropTypes.func,
    panel: PropTypes.element,
    highlight: PropTypes.bool,
    isEmpty: PropTypes.bool
  }

  static defaultProps = {
    onClick: () => {}
  }

  render() {
    const {
      buttons,
      image,
      headline,
      message,
      onClick,
      letter,
      panel,
      highlight,
      isEmpty,
      draggable,
      item
    } = this.props
    return (
      <div
        className="two-line-entry"
        draggable={draggable}
        onDragStart={ev => {
          ev.dataTransfer.setData('text/plain', JSON.stringify(item))
        }}
      >
        <div className={`list-row${isEmpty ? ' isEmpty' : ''}`} onClick={onClick}>
          {image && (
            <img
              className={`list-image${highlight ? ' list-highlight' : ''}`}
              src={image}
              alt={item.provider}
              title={item.provider}
            />
          )}
          {letter && !image && (
            <span className={`list-letter${highlight ? ' list-highlight' : ''}`} title={item.provider}>
              {letter.slice(0, 1)}
            </span>
          )}
          <div className="list-body">
            <div className="list-headline">{headline}</div>
            <div className="list-message">{message}</div>
          </div>
          {buttons}
        </div>
        {!isEmpty && panel && <div className="list-panel">{panel}</div>}
      </div>
    )
  }
}
