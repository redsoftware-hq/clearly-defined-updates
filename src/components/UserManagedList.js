// Copyright (c) Microsoft Corporation and others. Licensed under the MIT license.
// SPDX-License-Identifier: MIT

import React from 'react'
import notification from 'antd/lib/notification'
import { saveAs } from 'file-saver'
import { ROUTE_SHARE } from '../utils/routingConstants'
import { getNotices } from '../api/clearlyDefined'
import { saveGist } from '../api/github'
import { Button } from 'react-bootstrap'
import { uiDefinitionsUpdateList, uiInfo, uiWarning } from '../actions/ui'
import EntitySpec from '../utils/entitySpec'
import { types } from '../utils/utils'
import NotificationButtons from './Navigation/Ui/NotificationButtons'
import { getDefinitionsAction, checkForMissingDefinition } from '../actions/definitionActions'
import { getCurationsAction } from '../actions/curationActions'
import SystemManagedList from './SystemManagedList'
import UrlShare from '../utils/urlShare'

/**
 * Abstracts methods for user-managed list
 * Extends the method of a system-managed list, implementing and exposing all the methods used in any list that need an interaction by the user (import or modify data)
 */
export default class UserManagedList extends SystemManagedList {
  constructor(props) {
    super(props)
    this.state = {
      activeFilters: {},
      activeSort: null,
      selected: {},
      sequence: 0,
      showFullDetail: false,
      path: null
    }
    this.readOnly = false
    this.multiSelectEnabled = true
    this.onAddComponent = this.onAddComponent.bind(this)
    this.onRemoveComponent = this.onRemoveComponent.bind(this)
    this.loadComponentList = this.loadComponentList.bind(this)
    this.onRemoveAll = this.onRemoveAll.bind(this)
    this.showVersionSelectorPopup = this.showVersionSelectorPopup.bind(this)
    this.applySelectedVersions = this.applySelectedVersions.bind(this)
    this.doSave = this.doSave.bind(this)
    this.doSaveAsUrl = this.doSaveAsUrl.bind(this)
    this.createGist = this.saveGist.bind(this)
    this.saveSpec = this.saveSpec.bind(this)
  }

  onRemoveComponent(component) {
    this.updateList({ remove: component })
  }

  onRemoveAll() {
    this.setState({ selected: [] })
    this.updateList({ removeAll: {} })
  }

  onSelectAll = ({ target }) => {
    if (!target.checked) {
      return this.setState({ selected: {} })
    }
    // create object with keys by index with all true
    this.setState({ selected: this.props.components.transformedList.reduce((o, _, i) => ({ ...o, [i]: true }), {}) })
  }

  toggleSelectAllCheckbox = index => {
    if (this.state.selected[index]) {
      this.setState(prevState => ({ selected: { ...prevState.selected, [index]: !prevState.selected } }))
    } else {
      this.setState(prevState => ({ selected: { ...prevState.selected, [index]: true } }))
    }
  }

  resetComponents = () =>
    this.props.components.transformedList.forEach(component => {
      const { changes, ...rest } = component
      this.onChangeComponent(component, rest)
    })

  showVersionSelectorPopup(component, multiple) {
    this.setState({ showVersionSelectorPopup: true, multipleVersionSelection: multiple, selectedComponent: component })
  }

  applySelectedVersions(versions) {
    const { multipleVersionSelection, selectedComponent } = this.state
    if (!multipleVersionSelection) {
      return this.setState({ showVersionSelectorPopup: false }, async () => {
        if (selectedComponent.changes) {
          const key = `open${Date.now()}`
          notification.open({
            message: 'This definition has some changes. All the unsaved changes will be lost.',
            btn: (
              <NotificationButtons
                onClick={async () => {
                  await this.onRemoveComponent(selectedComponent)
                  await this.onAddComponent(
                    EntitySpec.fromObject({ ...selectedComponent, revision: versions, changes: {} })
                  )
                  notification.close(key)
                }}
                onClose={() => notification.close(key)}
                confirmText="Ok"
                dismissText="Cancel"
              />
            ),
            key,
            onClose: notification.close(key),
            duration: 0
          })
        } else {
          await this.onRemoveComponent(selectedComponent)
          await this.onAddComponent(EntitySpec.fromObject({ ...selectedComponent, revision: versions }))
        }
      })
    }
    this.setState({ showVersionSelectorPopup: false }, () =>
      versions.map(version => this.onAddComponent(EntitySpec.fromObject({ ...selectedComponent, revision: version })))
    )
  }

  onAddComponent(value) {
    const { dispatch, token, definitions, curations } = this.props
    const component = typeof value === 'string' ? EntitySpec.fromPath(value) : value
    const path = component.toPath()
    if (!component.revision) return uiWarning(dispatch, `${path} needs version information`)

    !definitions.entries[path] && dispatch(getDefinitionsAction(token, [path]))
    !curations.entries[path] && dispatch(getCurationsAction(token, [path]))
    dispatch(uiDefinitionsUpdateList({ add: component }))
    dispatch(checkForMissingDefinition(token, true))
  }

  loadComponentList(content, name) {
    const list = this.getList(content)
    if (!list) return uiWarning(this.props.dispatch, `Invalid component list file: ${name}`)
    this.loadFromListSpec(list)
  }

  getList(content) {
    try {
      const object = typeof content === 'string' ? JSON.parse(content) : content
      if (this.isPackageLock(object)) return this.getListFromPackageLock(object.dependencies)
      if (this.isFossaInput(object)) return this.getListFromFossaPackage(object.Build.Dependencies)
      if (this.isClearlyDefinedList(object)) return object
    } catch (error) {}
    return null
  }

  isPackageLock(content) {
    // TODO better, more definitive test here
    return !!content.dependencies
  }

  isFossaInput(content) {
    return !!content.Build.Dependencies
  }

  isClearlyDefinedList(content) {
    // TODO better, more definitive test here
    return !!content.coordinates
  }

  getListFromPackageLock(dependencies) {
    const coordinates = []
    for (const dependency in dependencies) {
      let [namespace, name] = dependency.split('/')
      if (!name) {
        name = namespace
        namespace = null
      }
      coordinates.push({ type: 'npm', provider: 'npmjs', namespace, name, revision: dependencies[dependency].version })
    }
    return { coordinates }
  }

  getListFromFossaPackage(dependencies) {
    const coordinates = []
    for (const dependency in dependencies) {
      const locator = dependencies[dependency].locator.split(/[\s+$/]+/)
      const type = types.find(item => item.value === locator[0])
      coordinates.push({
        type: type.value,
        provider: type.provider,
        namespace: locator.length > 3 ? locator[1] : '-',
        name: locator.length > 3 ? locator[2] : locator[1],
        revision: locator.length > 3 ? locator[3] : locator[2]
      })
    }
    return { coordinates }
  }

  loadFromListSpec(list) {
    const { dispatch, curations, definitions } = this.props
    if (list.filter) this.setState({ activeFilters: list.filter })
    if (list.sortBy) this.setState({ activeSort: list.sortBy })
    if (list.sortBy || list.filter) this.setState({ sequence: this.state.sequence + 1 })

    const toAdd = list.coordinates.map(component => EntitySpec.validateAndCreate(component)).filter(e => e)
    dispatch(uiDefinitionsUpdateList({ addAll: toAdd }))
    const missingDefinitions = toAdd.map(spec => spec.toPath()).filter(path => !definitions.entries[path])
    const missingCurations = toAdd.map(spec => spec.toPath()).filter(path => !curations.entries[path])
    this.getDefinitionsAndNotify(missingDefinitions, 'All components have been loaded')
    this.getCurations(missingCurations)
    dispatch(
      uiDefinitionsUpdateList({
        transform: this.createTransform.call(
          this,
          list.sortBy || this.state.activeSort,
          list.filter || this.state.activeFilters
        )
      })
    )
  }

  async doSave() {
    const { components } = this.props
    const spec = this.buildSaveSpec(components.list)
    this.setState({ showSavePopup: false })
    await this.saveSpec(spec)
  }

  async saveSpec(spec) {
    const { dispatch } = this.props
    const { options } = this.state
    try {
      if (this.state.saveType === 'notice') return this.saveNotices(spec, options)
      const fileObject = { filter: this.state.activeFilters, sortBy: this.state.activeSort, coordinates: spec }
      if (this.state.saveType === 'gist') await this.saveGist(options.filename, fileObject)
      else saveAs(new File([JSON.stringify(fileObject, null, 2)], `${options.filename}.json`))
    } catch (error) {
      if (error.status === 404)
        return uiWarning(dispatch, "Could not create Gist. Likely you've not given us permission")
      uiWarning(dispatch, error.message)
    }
  }

  async saveNotices(coordinates, options) {
    const { token, dispatch } = this.props
    uiInfo(dispatch, `Creating Notice file for ${coordinates.length} coordinates...`)
    const list = coordinates.map(entry => entry.toString())
    const notices = await getNotices(token, list, options.renderer, options.options)
    const { summary, content } = notices
    const message = `Created Notice file with ${summary.total} entries`
    if (summary.warnings.noLicense.length) uiWarning(dispatch, this._renderNoticeProblem(message, summary))
    else uiInfo(dispatch, message)
    return saveAs(new File([content], `${options.filename}`))
  }

  _renderNoticeProblem(baseMessage, summary) {
    return (
      <div>
        {`${baseMessage}, and ${summary.warnings.noLicense.length} missing licenses`}
        <div>
          <Button bsStyle="warning" onClick={() => this.onFilter({ 'licensed.declared': 'ABSENCE OF' }, true)}>
            Filter
          </Button>
          <span>&nbsp;to show just the problem definitions</span>
        </div>
      </div>
    )
  }
  async saveGist(name, content) {
    const { token, dispatch } = this.props
    const url = await saveGist(token, `${name}.json`, JSON.stringify(content))
    const message = (
      <div>
        A new Gist File has been created and is available{' '}
        <a href={url} target="_blank" rel="noopener noreferrer">
          here
        </a>
      </div>
    )
    return uiInfo(dispatch, message)
  }

  doSaveAsUrl() {
    const { components } = this.props
    const spec = this.buildSaveSpec(components.list)
    const fileObject = { filter: this.state.activeFilters, sortBy: this.state.activeSort, coordinates: spec }
    const urlShare = new UrlShare(fileObject)
    urlShare.start()
    try {
      urlShare.isValid()
      const message = urlShare.toMessage()
      const encodedMessage = urlShare.encode(message)
      const url = `${document.location.origin}${ROUTE_SHARE}/${encodedMessage}`
      this.copyToClipboard(url, 'URL copied to clipboard')
    } catch (e) {
      return false
    }
  }

  copyToClipboard(text, message) {
    const textArea = document.createElement('textarea')
    textArea.value = text
    document.body.appendChild(textArea)
    textArea.focus()
    textArea.select()
    document.execCommand('copy')
    document.body.removeChild(textArea)
    uiInfo(this.props.dispatch, message)
  }
}
