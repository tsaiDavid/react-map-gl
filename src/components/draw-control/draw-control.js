import React from 'react';
import PropTypes from 'prop-types';
import {MjolnirEvent} from 'mjolnir.js';

import BaseControl from '../base-control';
import Feature from './feature';

const FEATURE_STYLES = {
  Point: {
    fillOpacity: 0.1,
    fill: '#f40',
    stroke: '#f00',
    strokeWidth: 2
  },
  LineString: {
    fillOpacity: 0.1,
    fill: 'none',
    stroke: '#00f',
    strokeWidth: 2
  },
  Polygon: {
    fillOpacity: 0.1,
    fill: '#8f0',
    stroke: '#0f0',
    strokeWidth: 2,
    strokeDasharray: '4,2'
  }
};

const MODES = {
  READ_ONLY: 'READ_ONLY',
  SELECT_FEATURE: 'SELECT_FEATURE',
  EDIT_VERTEX: 'EDIT_VERTEX',
  DRAW_POINT: 'DRAW_POINT',
  DRAW_PATH: 'DRAW_PATH',
  DRAW_POLYGON: 'DRAW_POLYGON'
};

const MODE_TO_TYPE = {
  [MODES.DRAW_POINT]: 'Point',
  [MODES.DRAW_PATH]: 'LineString',
  [MODES.DRAW_POLYGON]: 'Polygon'
};

const OPERATIONS = {
  SET: 'SET',
  INTERSECT: 'INTERSECT'
};

const STATIC_STYLE = {
  cursor: 'default',
  pointerEvents: 'none'
};

const VERTEX_RADIUS = 10;

const propTypes = {
  ...BaseControl.propTypes,
  onSelect: PropTypes.func.isRequired,
  onUpdate: PropTypes.func.isRequired
};

const defaultProps = Object.assign({}, BaseControl.defaultProps, {
  captureClick: true
});

export default class DrawControl extends BaseControl {
  static propTypes = propTypes;
  static defaultProps = defaultProps;

  constructor(props) {
    super(props);

    this.state = {
      ...this.state,
      features: props.features ? props.features.map(f => Feature.fromFeature(f)) : null,
      selectedId: null,
      draggingVertex: -1,
      startDragPos: {},
      isDragging: false,
      didDrag: false
    };
  }

  componentWillReceiveProps(nextProps) {
    if (this.props.mode !== nextProps.mode || this.props.features !== nextProps.features) {
      this.setState({
        features: nextProps.features.map(f => Feature.fromFeature(f))
      });
    }
    if (this.props.mode !== nextProps.mode || this.props.selectedId !== nextProps.selectedId) {
      this.setState({selectedId: nextProps.selectedId});
    }
  }

  componentDidMount() {
    super.componentDidMount();
    this._setupEvents();
  }

  componentWillUnmount() {
    super.componentWillUnmount();
    this._removeEvents();
  }

  _setupEvents() {
    const {eventManager} = this._context;
    const containerRef = this._containerRef.current;
    if (!eventManager) {
      return;
    }

    // panstart is already attached by parent class BaseControl,
    // here we just add listeners for subsequent drag events
    this._events = {
      click: evt => this._onEvent(this._onClick, evt),
      pointermove: evt => this._onEvent(this._onMouseMove, evt),
      pointerdown: (evt) => this._onEvent(this._onMouseDown, evt),
      pointerup: evt => this._onEvent(this._onMouseUp, evt)
    };

    eventManager.on(this._events, containerRef);
  }

  _removeEvents() {
    const {eventManager} = this._context;
    if (!eventManager || !this._events) {
      return;
    }
    eventManager.off(this._events);
    this._events = null;
  }

  _update = (features) => {
    this.props.onUpdate(features.map(f => f.toFeature()));
  };

  _addPoint = (x, y, feature) => {
    const {mode} = this.props;
    const selectedFeature = feature || this._getSelectedFeature();
    const lngLat = this._unproject([x, y]);

    if (selectedFeature) {
      selectedFeature.addPoint([lngLat[0], lngLat[1]]);
    }

    const isNew = !this.state.features.find(f => f.id === feature.id);
    const features = isNew ? [...this.state.features, feature] : [...this.state.features];
    if (
      mode === MODES.DRAW_POINT ||
      (mode === MODES.DRAW_PATH && feature.points.length >= 2)
    ) {
      this._update(features);
      this.props.onSelect(feature.id);
    } else {
      this.setState({
        features,
        selectedId: feature.id
      });
    }
  };

  _closePath = () => {
    const selectedFeature = this._getSelectedFeature();
    selectedFeature.closePath();
    this._update(this.state.features);
    this.props.onSelect(selectedFeature.id);
  };

  _onEvent = (handler, evt, ...args) => {
    const {mode} = this.props;
    if (
      mode === MODES.READ_ONLY ||
      (mode === MODES.SELECT_FEATURE && handler !== this._onClickFeature)
    ) {
      evt.stopPropagation();
      return;
    }

    handler(evt, ...args);
  };

  _onMouseUp = (evt) => {
    evt.stopPropagation();
    this.setState({
      isDragging: false,
      didDrag: false
    });
    const {draggingVertex} = this.state;
    if (draggingVertex >= 0) {
      this.setState({
        draggingVertex: -1
      });
      this._update(this.state.features);
    }
  };

  _onMouseDown = (evt) => {
    const elem = evt.target;
    if (elem.className.baseVal.startsWith('vertex')) {
      const [index] = elem.id.split('.');
      this._onDragVertex(evt, index);
    }
  };

  _onDragVertex = (evt, index) => {
    const {x, y} = this._getEventPosition(evt);
    this.setState({
      draggingVertex: index,
      startDragPos: {x, y},
      isDragging: true,
      didDrag: false
    });
  };

  _onMouseMove = (evt) => {
    evt.stopPropagation();
    const {x, y} = this._getEventPosition(evt);
    const {startDragPos, isDragging, didDrag, draggingVertex} = this.state;
    if (isDragging && !didDrag) {
      const dx = x - startDragPos.x;
      const dy = y - startDragPos.y;
      if (dx * dx + dy * dy > 5) {
        this.setState({didDrag: true});
      }
    }

    if (isDragging && draggingVertex >= 0) {
      const lngLat = this._unproject([x, y]);
      const selectedFeature = this._getSelectedFeature();

      if (selectedFeature) {
        selectedFeature.replacePoint(draggingVertex, [lngLat[0], lngLat[1]]);
      }
    }
  };

  _addFeature = (type, point) => {
    const feature = new Feature({
      id: Date.now(),
      type,
      renderType: type
    });

    this._addPoint(point.x, point.y, feature);
  };

  _onClick = (evt: MjolnirEvent) => {
    if (evt.type !== 'anyclick') {
      return;
    }

    const elem = evt.target;

    if (elem.className.baseVal.startsWith('feature')) {
      this._onClickFeature(evt, this.state.features[elem.id]);
      return;
    }

    if (elem.className.baseVal.startsWith('vertex')) {
      const [index, operation] = elem.id.split('.');
      this._onClickVertex(evt, index, operation);
      return;
    }

    if (this.state.didDrag) {
      return;
    }

    evt.stopImmediatePropagation();
    const {mode} = this.props;
    const selectedFeature = this._getSelectedFeature();
    const {x, y} = this._getEventPosition(evt);

    switch (mode) {
    case MODES.DRAW_POINT:
      this._addFeature(MODE_TO_TYPE[mode], {x, y});
      break;

    case MODES.DRAW_PATH:
    case MODES.DRAW_POLYGON:
      // only polygon can be closed
      if (selectedFeature && selectedFeature.isClosed) {
        // clicked outside
        this.props.onSelect(null);

      } else if (selectedFeature) {
        this._addPoint(x, y, selectedFeature);

      } else {
        this._addFeature(MODE_TO_TYPE[mode], {x, y});

      }
      break;

    default:
    }
  };

  _onClickFeature = (evt, feature) => {
    if (
      this.props.mode === MODES.SELECT_FEATURE ||
      this.props.mode === MODES.EDIT_VERTEX ||
      !this.state.selectedId
    ) {
      this.props.onSelect(feature.id);
      evt.stopPropagation();
    }
  };

  _onClickVertex = (evt, index, operation) => {
    if (operation === OPERATIONS.INTERSECT) {
      this._closePath();
    }
    evt.stopPropagation();
  };

  _project = (pt) => {
    const {viewport} = this._context;
    return viewport.project(pt);
  };

  _unproject = (pt) => {
    const {viewport} = this._context;
    return viewport.unproject(pt);
  };

  _getEventPosition(evt) {
    const {offsetCenter: {x, y}} = evt;
    return {x, y};
  }

  _getProjectedData({points, type, isClosed}) {
    if (points.length === 0) {
      return '';
    }

    const projected = points.map(p => this._project(p));
    switch (type) {
    case 'Point':
      return projected;
    case 'LineString':
    case 'Polygon':
      const pathString = projected.map(p => {
        return `${p[0]},${p[1]}`;
      }).join('L');
      return `M ${pathString} ${isClosed ? 'z' : ''}`;
    default:
      return null;
    }
  }

  _getSelectedFeature = () => {
    const {features, selectedId} = this.state;
    return features && features.find(f => f.id === selectedId);
  };

  _renderVertex(coords, index, operation, radius, style) {
    const p = this._project(coords);
    return (
      <g className="vertex-group" key={index} id={`${index}.${operation}`}
         transform={`translate (${p[0]} ${p[1]})`} style={style}>
        <circle
          id={`${index}.${operation}`}
          key={index}
          className="vertex"
          cx={0}
          cy={0}
          r={radius}
        />
      </g>
    );
  }

  _renderCurrent() {
    const {mode} = this.props;
    const feature = this._getSelectedFeature();
    const {points, isClosed} = feature;
    const style = FEATURE_STYLES[feature.otherProps.renderType];

    return (
      <g style={(mode === MODES.READ_ONLY || mode === MODES.SELECT) ? STATIC_STYLE : null}>
        {points.length > 1 && <path style={style} d={this._getProjectedData(feature)}/>}
        <g>{
          points.map((p, i) => {
            let operation = OPERATIONS.SET;
            if (isClosed) {
              return (
                this._renderVertex(p, i, operation, VERTEX_RADIUS, style)
              );
            }

            if (mode === MODES.DRAW_POLYGON && i === 0 && points.length > 2) {
              operation = OPERATIONS.INTERSECT;
            }

            return (
              this._renderVertex(p, i, operation, VERTEX_RADIUS, style)
            );
          })}
        </g>
      </g>
    );
  }

  _renderFeature = (feature, index) => {
    if (feature === this._getSelectedFeature()) {
      return null;
    }

    const {type} = feature;
    const style = FEATURE_STYLES[type];
    const points = this._getProjectedData(feature);

    switch (type) {
    case 'Point':
      return (
        <circle
          className="feature point"
          key={index}
          id={index}
          style={style}
          cx={points[0][0]}
          cy={points[0][1]}
          r={VERTEX_RADIUS * 0.7}
        />
      );

    case 'LineString':
      return (
        <path
          className="feature line-string"
          key={index}
          id={index}
          style={style}
          d={this._getProjectedData(feature)}
        />
      );

    case 'Polygon':
      return (
        <path
          className="feature polygon"
          key={index}
          id={index}
          style={style}
          d={this._getProjectedData(feature)}
        />
      );

    default:
      return null;
    }
  };

  _renderFeatures() {
    const {features} = this.state;
    return features.map(this._renderFeature);
  }

  _renderCanvas() {
    const {selectedId} = this.state;

    return (
      <svg className="draw-canvas" key="draw-canvas" width="100%" height="100%">
        <g className="feature-group" key="feature-group">
          {this._renderFeatures()}
        </g>
        {selectedId && this._renderCurrent()}
      </svg>
    );
  }

  _render() {
    const {mode} = this.props;
    const {viewport: {width, height}} = this._context;

    if (width <= 0 || height <= 0) {
      return null;
    }

    return (
      <div
        className="draw-control"
        id="draw-control"
        style={{
          ...(mode === MODES.READ_ONLY ? STATIC_STYLE : null),
          width,
          height
        }}
        ref={this._containerRef.current}
      >
        {this._renderCanvas()}
      </div>
    );
  }
}

Object.keys(MODES).forEach(m => {
  DrawControl[m] = MODES[m];
});
