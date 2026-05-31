import {
  createBalancedParsedPathsPlanResult,
  getPathOperationValue,
  interpolateBalancedParsedPathsResult,
  interpolatePathDataResult,
  interpolatePathMorphPlanResult,
  parseSvgPathDataResult,
  penPathToSvgPathData,
  translateSvgPathDataResult,
} from './pathMorphRuntime.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DEBUG_PANEL_UPDATE_INTERVAL_MS = 120;
const DEFAULT_TRANSITION_EFFECT = {
  mode: 'none',
  targetFramePolicy: 'first-frame',
  fallbackMode: 'crossfade',
  paletteBits: 5,
  maxMatchDistance: 24,
};

const PROPERTY_MAP = {
  x: 'position.x',
  y: 'position.y',
  positionX: 'position.x',
  positionY: 'position.y',
  scaleX: 'scale.x',
  scaleY: 'scale.y',
  rotation: 'rotation',
  opacity: 'opacity',
  fill: 'fill',
  stroke: 'stroke',
  path: 'path',
  revealPathLengthStart: 'revealPath.lengthStart',
  revealPathLengthEnd: 'revealPath.lengthEnd',
  revealPathOffset: 'revealPath.offset',
};

const NUMERIC_PROPERTY_KEYS = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity'];
const TRANSFORM_PROPERTY_KEYS = ['x', 'y', 'scaleX', 'scaleY', 'rotation'];
const STATIC_COMPILED_KEYFRAME_SOURCE = 'export-static-default';
const EASING_PRESET_DEFINITIONS = {
  linear: [0, 0, 1, 1],
  natural: [0.33, 0, 0.2, 1],
  smooth: [0.37, 0, 0.63, 1],
  'slow-down': [0, 0, 0.2, 1],
  accelerate: [0.4, 0, 1, 1],
  overshoot: [0.34, 1.25, 0.64, 1],
};
const LEGACY_EASING_ALIASES = {
  'ease-in': 'accelerate',
  'ease-out': 'slow-down',
  'ease-in-out': 'smooth',
};
const KNOWN_PROPERTIES = new Set([
  ...Object.values(PROPERTY_MAP),
  'position.x',
  'position.y',
  'scale.x',
  'scale.y',
  'rotation',
  'opacity',
  'fill',
  'stroke',
  'path',
  'revealPath.lengthStart',
  'revealPath.lengthEnd',
  'revealPath.offset',
]);

function normalizeParamValue(param, value) {
  if (param.type === 'number') {
    return toFiniteNumber(value, toFiniteNumber(param.defaultValue, 0));
  }

  if (param.type === 'bool' || param.type === 'trigger') {
    return value === true;
  }

  const option = typeof value === 'string' ? value : String(param.defaultValue ?? '');
  return param.enumOptions?.includes(option) ? option : param.enumOptions?.[0] ?? option;
}

function createParamValues(machine, current = {}) {
  const values = {};

  machine.params.forEach((param) => {
    values[param.name] = normalizeParamValue(param, current[param.name] ?? param.defaultValue);
  });

  return values;
}

function getLayerDefaultState(layer) {
  return layer.states.find((state) => state.id === layer.defaultStateId) ?? layer.states[0] ?? null;
}

function createStateMachineRuntime(machine) {
  const layers = {};

  machine.layers.forEach((layer) => {
    const state = getLayerDefaultState(layer);

    if (!state) {
      return;
    }

    layers[layer.id] = {
      currentStateId: state.id,
      stateFrame: 0,
      transition: null,
    };
  });

  return {
    machineId: machine.id,
    layers,
  };
}

function compareConditionValue(left, operator, right) {
  if (operator === '==') {
    return left === right;
  }

  const leftNumber = Number(left);
  const rightNumber = Number(right);

  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) {
    return false;
  }

  if (operator === '>') return leftNumber > rightNumber;
  if (operator === '>=') return leftNumber >= rightNumber;
  if (operator === '<') return leftNumber < rightNumber;
  return leftNumber <= rightNumber;
}

function evaluateConditions(transition, paramValues) {
  return transition.conditions.length === 0 || transition.conditions.every((condition) =>
    compareConditionValue(paramValues[condition.paramName], condition.operator, condition.value));
}

function normalizeTransitionEffect(effect) {
  if (typeof effect === 'string') {
    return {
      ...DEFAULT_TRANSITION_EFFECT,
      mode: effect,
    };
  }

  return {
    ...DEFAULT_TRANSITION_EFFECT,
    ...(effect && typeof effect === 'object' ? effect : {}),
  };
}

function normalizeTransitionExitTime(value) {
  return {
    enabled: value?.enabled === true,
    normalized: clamp(toFiniteNumber(value?.normalized, 0), 0, 1),
  };
}

function hasStateCompleted(document, state, frame) {
  const duration = getStateDuration(document, state);

  if (duration <= 0) {
    return true;
  }

  const completionFrame = state.loop ? Math.max(0, duration - 1) : duration;

  return Math.max(0, frame) >= completionFrame;
}

function hasReachedExitTime(document, state, frame, transition) {
  const exitTime = normalizeTransitionExitTime(transition.exitTime);

  if (!exitTime.enabled) {
    return true;
  }

  const duration = getStateDuration(document, state);

  if (duration <= 0) {
    return true;
  }

  const completionFrame = state.loop ? Math.max(0, duration - 1) : duration;

  return Math.max(0, frame) >= completionFrame * exitTime.normalized;
}

function isTransitionTimingSatisfied(document, sourceState, sourceFrame, transition) {
  if (transition.onComplete === true) {
    return hasStateCompleted(document, sourceState, sourceFrame);
  }

  return hasReachedExitTime(document, sourceState, sourceFrame, transition);
}

function selectTransition(document, layer, currentState, currentFrame, paramValues) {
  const stateIds = new Set(layer.states.map((state) => state.id));

  return [...layer.transitions]
    .filter((transition) =>
      (transition.fromStateId === 'any' || transition.fromStateId === currentState.id) &&
      transition.toStateId !== currentState.id &&
      stateIds.has(transition.toStateId) &&
      evaluateConditions(transition, paramValues))
    .filter((transition) =>
      isTransitionTimingSatisfied(document, currentState, currentFrame, transition))
    .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0))[0] ?? null;
}

function shouldConsumeConditionParam(layer, transition, param) {
  if (transition.consumeConditions === true) {
    return true;
  }

  if (param.type !== 'enum') {
    return false;
  }

  const targetState = layer.states.find((state) => state.id === transition.toStateId);

  if (!targetState || targetState.loop) {
    return false;
  }

  return layer.transitions.some((candidate) =>
    candidate.fromStateId === targetState.id &&
    candidate.toStateId !== targetState.id &&
    candidate.onComplete === true);
}

function consumeTransitionConditions(machine, layer, transition, paramValues) {
  if (!transition) {
    return paramValues;
  }

  const paramsByName = new Map(machine.params.map((param) => [param.name, param]));
  const nextValues = { ...paramValues };
  let changed = false;

  transition.conditions.forEach((condition) => {
    const param = paramsByName.get(condition.paramName);

    if (!param) {
      return;
    }

    if (param.type === 'trigger') {
      nextValues[condition.paramName] = false;
      changed = true;
      return;
    }

    if (!shouldConsumeConditionParam(layer, transition, param)) {
      return;
    }

    nextValues[condition.paramName] = normalizeParamValue(param, param.defaultValue);
    changed = true;
  });

  return changed ? nextValues : paramValues;
}

function getStateDuration(document, state) {
  return Math.max(0, document.clips[state.clipId]?.timeline.durationFrames ?? 0);
}

function advanceStateFrame(document, state, currentFrame, deltaFrames) {
  const duration = getStateDuration(document, state);
  const speed = Math.max(0.01, state.speed || 1);
  const rawFrame = Math.max(0, currentFrame + deltaFrames * speed);

  if (duration <= 0) {
    return 0;
  }

  return state.loop ? rawFrame % duration : Math.min(rawFrame, duration);
}

function resolveCompletedTransitionTargetFrame(document, targetState, transition, elapsedFrames, leftoverFrames) {
  const effect = normalizeTransitionEffect(transition.effect);
  const targetBaseFrame = effect.targetFramePolicy === 'current-frame'
    ? (transition.toFrame ?? 0) + elapsedFrames
    : transition.toFrame ?? 0;

  return advanceStateFrame(document, targetState, targetBaseFrame, leftoverFrames);
}

function resolveActiveTransition(stateMap, layerRuntime) {
  const transition = layerRuntime?.transition;

  if (!transition || !stateMap.has(transition.fromStateId) || !stateMap.has(transition.toStateId)) {
    return null;
  }

  return {
    ...transition,
    elapsedFrames: Math.max(0, toFiniteNumber(transition.elapsedFrames, 0)),
    durationFrames: Math.max(0, Math.round(toFiniteNumber(transition.durationFrames, 0))),
    effect: normalizeTransitionEffect(transition.effect),
    fromFrame: Math.max(0, toFiniteNumber(transition.fromFrame ?? layerRuntime?.stateFrame, 0)),
    toFrame: Math.max(0, toFiniteNumber(transition.toFrame, 0)),
  };
}

function getClipActiveNodeIds(clip) {
  const explicit = clip?.stateAnim?.activeNodeIds ?? [];

  if (explicit.length > 0) {
    return new Set(explicit);
  }

  const used = Object.entries(clip?.layerUsage ?? {})
    .filter(([, active]) => active)
    .map(([nodeId]) => nodeId);

  if (used.length > 0) {
    return new Set(used);
  }

  return new Set(Object.keys(clip?.tracks ?? {}));
}

function resolveBasePropertyValue(node, property) {
  if (property === 'position.x') return node.x;
  if (property === 'position.y') return node.y;
  if (property === 'rotation') return node.rotation;
  if (property === 'opacity') return node.opacity;
  if (property === 'scale.x' || property === 'scale.y') return 1;
  if (property === 'fill') return node.fill ?? '#000000';
  if (property === 'stroke') return node.stroke ?? '#000000';
  if (property === 'revealPath.lengthStart') return node.revealPath?.lengthStart ?? 0;
  if (property === 'revealPath.lengthEnd') return node.revealPath?.lengthEnd ?? 1;
  if (property === 'revealPath.offset') return node.revealPath?.offset ?? 0;
  return 0;
}

function resolveFrameKeyframes(keyframes) {
  return [...(keyframes ?? [])].sort((left, right) => left.frame - right.frame);
}

function normalizeCubicBezierPoints(value) {
  if (!Array.isArray(value) || value.length < 4) {
    return null;
  }

  return [
    clamp(toFiniteNumber(value[0], 0), 0, 1),
    clamp(toFiniteNumber(value[1], 0), -1, 2),
    clamp(toFiniteNumber(value[2], 1), 0, 1),
    clamp(toFiniteNumber(value[3], 1), -1, 2),
  ];
}

function cubicBezierCoordinate(t, p1, p2) {
  const inverse = 1 - t;
  return (3 * inverse * inverse * t * p1) + (3 * inverse * t * t * p2) + (t * t * t);
}

function cubicBezierDerivative(t, p1, p2) {
  const inverse = 1 - t;
  return (3 * inverse * inverse * p1) + (6 * inverse * t * (p2 - p1)) + (3 * t * t * (1 - p2));
}

function cubicBezierProgress(points, progress) {
  const [x1, y1, x2, y2] = points;
  const x = clamp(progress, 0, 1);
  let t = x;

  for (let index = 0; index < 6; index += 1) {
    const currentX = cubicBezierCoordinate(t, x1, x2) - x;
    const derivative = cubicBezierDerivative(t, x1, x2);

    if (Math.abs(currentX) < 0.00001 || Math.abs(derivative) < 0.00001) {
      break;
    }

    t = clamp(t - currentX / derivative, 0, 1);
  }

  let lower = 0;
  let upper = 1;

  for (let index = 0; index < 14; index += 1) {
    const currentX = cubicBezierCoordinate(t, x1, x2);

    if (Math.abs(currentX - x) < 0.00001) {
      break;
    }

    if (currentX < x) {
      lower = t;
    } else {
      upper = t;
    }

    t = (lower + upper) / 2;
  }

  return cubicBezierCoordinate(t, y1, y2);
}

function bounceOutProgress(t) {
  const n1 = 7.5625;
  const d1 = 2.75;

  if (t < 1 / d1) {
    return n1 * t * t;
  }

  if (t < 2 / d1) {
    const shifted = t - 1.5 / d1;
    return n1 * shifted * shifted + 0.75;
  }

  if (t < 2.5 / d1) {
    const shifted = t - 2.25 / d1;
    return n1 * shifted * shifted + 0.9375;
  }

  const shifted = t - 2.625 / d1;
  return n1 * shifted * shifted + 0.984375;
}

function resolveEasingProgress(easing, progress) {
  const t = clamp(progress, 0, 1);

  if (easing && typeof easing === 'object' && easing.type === 'cubic-bezier') {
    const points = normalizeCubicBezierPoints(easing.points);
    return points ? cubicBezierProgress(points, t) : t;
  }

  const preset = typeof easing === 'string'
    ? LEGACY_EASING_ALIASES[easing] ?? easing
    : 'linear';

  if (preset === 'hold') return 0;
  if (preset === 'bounce-in') return 1 - bounceOutProgress(1 - t);
  if (preset === 'bounce-out') return bounceOutProgress(t);

  const points = EASING_PRESET_DEFINITIONS[preset] ?? EASING_PRESET_DEFINITIONS.linear;
  return cubicBezierProgress(points, t);
}

function evaluateNumericKeyframes(keyframes, frame, fallbackValue) {
  const sorted = resolveFrameKeyframes(keyframes);

  if (sorted.length === 0) {
    return fallbackValue;
  }

  if (frame <= sorted[0].frame) {
    return toFiniteNumber(sorted[0].value, fallbackValue);
  }

  const last = sorted[sorted.length - 1];

  if (frame >= last.frame) {
    return toFiniteNumber(last.value, fallbackValue);
  }

  const nextIndex = sorted.findIndex((keyframe) => keyframe.frame >= frame);
  const next = sorted[nextIndex];
  const previous = sorted[nextIndex - 1];
  const previousValue = toFiniteNumber(previous.value, fallbackValue);
  const nextValue = toFiniteNumber(next.value, fallbackValue);
  const progress = next.frame === previous.frame
    ? 1
    : resolveEasingProgress(previous.easing, (frame - previous.frame) / (next.frame - previous.frame));

  return previousValue + (nextValue - previousValue) * progress;
}

function hexToRgb(value) {
  const hex = normalizeHexColor(value, '#000000').replace('#', '');
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function mixColor(left, right, weight) {
  const leftRgb = hexToRgb(left);
  const rightRgb = hexToRgb(right);

  return rgbToHex(
    leftRgb.r + (rightRgb.r - leftRgb.r) * weight,
    leftRgb.g + (rightRgb.g - leftRgb.g) * weight,
    leftRgb.b + (rightRgb.b - leftRgb.b) * weight,
  );
}

function getPathOverrideData(value) {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (value && typeof value === 'object' && typeof value.pathData === 'string') {
    return value.pathData.trim();
  }

  return '';
}

function blendPathOverride(fromPath, toPath, weight, pathMorphPlan) {
  const fromPathData = getPathOverrideData(fromPath);
  const toPathData = getPathOverrideData(toPath);
  const endpointPath = weight >= 0.5 ? toPathData || fromPathData : fromPathData || toPathData;

  if (!fromPathData || !toPathData) {
    return endpointPath ? { pathData: endpointPath } : undefined;
  }

  const morphResult = pathMorphPlan
    ? interpolatePathMorphPlanResult(pathMorphPlan, weight)
    : interpolatePathDataPairResult(fromPathData, toPathData, weight);
  const morphedPath = morphResult ? getPathOperationValue(morphResult) : null;

  if (!morphedPath) {
    return { pathData: endpointPath };
  }

  return {
    pathData: penPathToSvgPathData(morphedPath.points, morphedPath.closed),
  };
}

function interpolatePathDataPairResult(fromPathData, toPathData, weight) {
  const fromPathResult = parseSvgPathDataResult(fromPathData);
  const toPathResult = parseSvgPathDataResult(toPathData);
  const parsedFromPath = getPathOperationValue(fromPathResult);
  const parsedToPath = getPathOperationValue(toPathResult);

  return parsedFromPath && parsedToPath
    ? interpolateBalancedParsedPathsResult(parsedFromPath, parsedToPath, weight)
    : null;
}

function createPathMorphPlanKey(fromNodeId, toNodeId) {
  return `${fromNodeId}=>${toNodeId}`;
}

function createPathMorphPlanFromOverrides(fromPath, toPath) {
  const fromPathData = getPathOverrideData(fromPath);
  const toPathData = getPathOverrideData(toPath);

  if (!fromPathData || !toPathData) {
    return null;
  }

  const parsedFromPath = getPathOperationValue(parseSvgPathDataResult(fromPathData));
  const parsedToPath = getPathOperationValue(parseSvgPathDataResult(toPathData));

  if (!parsedFromPath || !parsedToPath) {
    return null;
  }

  return getPathOperationValue(createBalancedParsedPathsPlanResult(parsedFromPath, parsedToPath));
}

function assignTransitionPathMorphPlan(plans, fromNodeId, toNodeId, fromOverride, toOverride) {
  const plan = createPathMorphPlanFromOverrides(fromOverride?.path, toOverride?.path);

  if (plan) {
    plans[createPathMorphPlanKey(fromNodeId, toNodeId)] = plan;
  }
}

function evaluateColorKeyframes(keyframes, frame, fallbackValue) {
  const sorted = resolveFrameKeyframes(keyframes);

  if (sorted.length === 0) {
    return normalizeHexColor(fallbackValue, '#000000');
  }

  if (frame <= sorted[0].frame) {
    return normalizeHexColor(sorted[0].value, fallbackValue);
  }

  const last = sorted[sorted.length - 1];

  if (frame >= last.frame) {
    return normalizeHexColor(last.value, fallbackValue);
  }

  const nextIndex = sorted.findIndex((keyframe) => keyframe.frame >= frame);
  const next = sorted[nextIndex];
  const previous = sorted[nextIndex - 1];
  const progress = next.frame === previous.frame
    ? 1
    : resolveEasingProgress(previous.easing, (frame - previous.frame) / (next.frame - previous.frame));

  return mixColor(
    normalizeHexColor(previous.value, fallbackValue),
    normalizeHexColor(next.value, fallbackValue),
    progress,
  );
}

function evaluatePathKeyframes(keyframes, frame, fallbackValue) {
  const sorted = resolveFrameKeyframes(keyframes)
    .map((keyframe) => ({
      ...keyframe,
      value: getPathOverrideData(keyframe.value),
    }))
    .filter((keyframe) => keyframe.value.length > 0);
  const fallbackPath = getPathOverrideData(fallbackValue);

  if (sorted.length === 0) {
    return fallbackPath;
  }

  if (frame <= sorted[0].frame) {
    return sorted[0].value;
  }

  const last = sorted[sorted.length - 1];

  if (frame >= last.frame) {
    return last.value;
  }

  const nextIndex = sorted.findIndex((keyframe) => keyframe.frame >= frame);
  const next = sorted[nextIndex];
  const previous = sorted[Math.max(0, nextIndex - 1)];

  if (!next || !previous || next.frame === previous.frame) {
    return previous?.value ?? fallbackPath;
  }

  const progress = resolveEasingProgress(previous.easing, (frame - previous.frame) / (next.frame - previous.frame));
  const morphResult = interpolatePathDataResult(previous.value, next.value, progress);
  const morphedPath = getPathOperationValue(morphResult);

  if (!morphedPath) {
    return progress >= 0.5 ? next.value : previous.value;
  }

  return penPathToSvgPathData(morphedPath.points, morphedPath.closed);
}

function evaluateDiscreteKeyframes(keyframes, frame, fallbackValue) {
  const sorted = resolveFrameKeyframes(keyframes);
  let value = fallbackValue;

  sorted.forEach((keyframe) => {
    if (keyframe.frame <= frame) {
      value = keyframe.value;
    }
  });

  return value;
}

function assignEvaluatedProperty(target, property, value) {
  if (property === 'position.x') target.x = value;
  else if (property === 'position.y') target.y = value;
  else if (property === 'scale.x') target.scaleX = value;
  else if (property === 'scale.y') target.scaleY = value;
  else if (property === 'rotation') target.rotation = value;
  else if (property === 'opacity') target.opacity = value;
  else if (property === 'fill') target.fill = value;
  else if (property === 'stroke') target.stroke = value;
  else if (property === 'path') target.path = { pathData: String(value ?? '') };
  else if (property.startsWith('revealPath.')) {
    target.revealPath = target.revealPath ?? { lengthStart: 0, lengthEnd: 1, offset: 0 };
    if (property === 'revealPath.lengthStart') target.revealPath.lengthStart = value;
    if (property === 'revealPath.lengthEnd') target.revealPath.lengthEnd = value;
    if (property === 'revealPath.offset') target.revealPath.offset = value;
  }
}

function evaluateClipAtFrame(document, clipId, frame, nodes, options = {}) {
  const clip = document.clips[clipId];
  const nodeOverrides = {};
  const unsupported = [];

  if (!clip) {
    return { frame, source: 'none', nodeOverrides, unsupported };
  }

  const activeNodeIds = getClipActiveNodeIds(clip);

  if (options.visibilityIsolation === 'opacity') {
    Object.values(nodes).forEach((node) => {
      if (!activeNodeIds.has(node.id)) {
        nodeOverrides[node.id] = { opacity: 0 };
      }
    });
  }

  activeNodeIds.forEach((nodeId) => {
    const node = nodes[nodeId];

    if (node) {
      nodeOverrides[nodeId] = {
        ...nodeOverrides[nodeId],
        opacity: node.opacity,
      };
    }
  });

  Object.values(clip.tracks ?? {}).forEach((track) => {
    const node = nodes[track.nodeId];

    if (!node) {
      unsupported.push({
        code: 'missing-node',
        message: `Track node is missing: ${track.nodeId}`,
        nodeId: track.nodeId,
      });
      return;
    }

    const target = nodeOverrides[track.nodeId] ?? {};

    Object.entries(track.channels ?? {}).forEach(([property, keyframes]) => {
      const fallback = resolveBasePropertyValue(node, property);
      let value;

      if (property === 'fill' || property === 'stroke') {
        value = evaluateColorKeyframes(keyframes, frame, fallback);
      } else if (property === 'path') {
        value = evaluatePathKeyframes(keyframes, frame, fallback);
      } else {
        value = evaluateNumericKeyframes(keyframes, frame, fallback);
      }

      assignEvaluatedProperty(target, property, value);
    });

    nodeOverrides[track.nodeId] = target;
  });

  return { frame, source: 'clip', nodeOverrides, unsupported };
}

function blendValue(left, right, weight, fallback) {
  const hasLeft = typeof left === 'number' && Number.isFinite(left);
  const hasRight = typeof right === 'number' && Number.isFinite(right);

  if (hasLeft && hasRight) {
    return left + (right - left) * weight;
  }

  if (hasRight) return right;
  if (hasLeft) return left;
  return fallback;
}

function resolveBaseNumericValue(node, key) {
  if (key === 'x') return node?.x ?? 0;
  if (key === 'y') return node?.y ?? 0;
  if (key === 'rotation') return node?.rotation ?? 0;
  if (key === 'opacity') return node?.opacity ?? 1;
  return 1;
}

function resolveBaseColorValue(node, key) {
  if (key === 'fill') {
    return normalizeHexColor(node?.fill, '#000000');
  }

  if (key === 'stroke') {
    return normalizeHexColor(node?.stroke, '#000000');
  }

  return '#000000';
}

function blendNodeOverrides(fromOverride = {}, toOverride = {}, weight, fromNode, toNode = fromNode, pathMorphPlan) {
  const target = {};

  NUMERIC_PROPERTY_KEYS.forEach((key) => {
    const fromValue = typeof fromOverride[key] === 'number'
      ? fromOverride[key]
      : resolveBaseNumericValue(fromNode, key);
    const toValue = typeof toOverride[key] === 'number'
      ? toOverride[key]
      : resolveBaseNumericValue(toNode, key);

    target[key] = fromValue + (toValue - fromValue) * weight;
  });

  ['fill', 'stroke'].forEach((key) => {
    const hasFromValue = typeof fromOverride[key] === 'string';
    const hasToValue = typeof toOverride[key] === 'string';

    if (!hasFromValue && !hasToValue) {
      return;
    }

    const fromValue = hasFromValue ? fromOverride[key] : resolveBaseColorValue(fromNode, key);
    const toValue = hasToValue ? toOverride[key] : resolveBaseColorValue(toNode, key);

    target[key] = mixColor(fromValue, toValue, weight);
  });

  target.path = blendPathOverride(fromOverride.path, toOverride.path, weight, pathMorphPlan);
  target.revealPath = weight >= 0.5 ? toOverride.revealPath ?? fromOverride.revealPath : fromOverride.revealPath ?? toOverride.revealPath;

  return Object.fromEntries(Object.entries(target).filter(([, value]) => value !== undefined));
}

function createActiveOverrideMatchIndex(nodes, overrides) {
  const index = new Map();

  Object.keys(overrides ?? {}).forEach((nodeId) => {
    const key = getNodeMatchKey(nodes[nodeId]);

    if (!key) {
      return;
    }

    const nodeIds = index.get(key) ?? [];

    nodeIds.push(nodeId);
    index.set(key, nodeIds);
  });

  return index;
}

function createMatchedTransitionPairs(nodes, fromOverrides, toOverrides) {
  const fromIndex = createActiveOverrideMatchIndex(nodes, fromOverrides);
  const toIndex = createActiveOverrideMatchIndex(nodes, toOverrides);
  const pairs = [];
  const fromMatched = new Set();
  const toMatched = new Set();

  fromIndex.forEach((fromNodeIds, matchKey) => {
    const toNodeIds = toIndex.get(matchKey) ?? [];
    const pairCount = Math.min(fromNodeIds.length, toNodeIds.length);

    for (let index = 0; index < pairCount; index += 1) {
      const fromNodeId = fromNodeIds[index];
      const toNodeId = toNodeIds[index];

      if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) {
        continue;
      }

      pairs.push({ fromNodeId, toNodeId });
      fromMatched.add(fromNodeId);
      toMatched.add(toNodeId);
    }
  });

  return { pairs, fromMatched, toMatched };
}

function createStateMachineTransitionPathMorphPlans(document, fromState, toState, nodes, fromFrame, toFrame) {
  const fromEvaluated = evaluateClipAtFrame(document, fromState.clipId, fromFrame, nodes);
  const toEvaluated = evaluateClipAtFrame(document, toState.clipId, toFrame, nodes);
  const matched = createMatchedTransitionPairs(nodes, fromEvaluated.nodeOverrides, toEvaluated.nodeOverrides);
  const plans = {};
  const nodeIds = new Set([
    ...Object.keys(fromEvaluated.nodeOverrides),
    ...Object.keys(toEvaluated.nodeOverrides),
  ]);

  nodeIds.forEach((nodeId) => {
    if (matched.fromMatched.has(nodeId) || matched.toMatched.has(nodeId)) {
      return;
    }

    assignTransitionPathMorphPlan(
      plans,
      nodeId,
      nodeId,
      fromEvaluated.nodeOverrides[nodeId],
      toEvaluated.nodeOverrides[nodeId],
    );
  });

  matched.pairs.forEach(({ fromNodeId, toNodeId }) => {
    assignTransitionPathMorphPlan(
      plans,
      fromNodeId,
      toNodeId,
      fromEvaluated.nodeOverrides[fromNodeId],
      toEvaluated.nodeOverrides[toNodeId],
    );
  });

  return Object.keys(plans).length > 0 ? plans : undefined;
}

function resolveTransitionBlendWeight(weight, effect = DEFAULT_TRANSITION_EFFECT) {
  if (effect.mode === 'cut') {
    return weight >= 1 ? 1 : 0;
  }

  return weight;
}

function blendEvaluatedStates(fromEvaluated, toEvaluated, weight, nodes, effect = DEFAULT_TRANSITION_EFFECT, pathMorphPlans) {
  const blendWeight = resolveTransitionBlendWeight(weight, effect);
  const nodeOverrides = {};
  const matched = createMatchedTransitionPairs(nodes, fromEvaluated.nodeOverrides, toEvaluated.nodeOverrides);
  const nodeIds = new Set([
    ...Object.keys(fromEvaluated.nodeOverrides),
    ...Object.keys(toEvaluated.nodeOverrides),
  ]);

  matched.pairs.forEach(({ fromNodeId, toNodeId }) => {
    const fromOverride = fromEvaluated.nodeOverrides[fromNodeId] ?? {};
    const toOverride = toEvaluated.nodeOverrides[toNodeId] ?? {};
    const toNode = nodes[toNodeId];
    const fromNode = nodes[fromNodeId];
    const blended = blendNodeOverrides(
      fromOverride,
      toOverride,
      blendWeight,
      fromNode,
      toNode,
      pathMorphPlans?.[createPathMorphPlanKey(fromNodeId, toNodeId)],
    );
    const fromOpacity = toFiniteNumber(fromOverride.opacity, fromNode?.opacity ?? 1);
    const toOpacity = toFiniteNumber(toOverride.opacity, toNode?.opacity ?? 1);

    blended.opacity = blendValue(fromOpacity, toOpacity, blendWeight, toOpacity);
    nodeOverrides[toNodeId] = blended;
    nodeOverrides[fromNodeId] = {
      ...(nodeOverrides[fromNodeId] ?? {}),
      opacity: 0,
    };
  });

  nodeIds.forEach((nodeId) => {
    if (matched.fromMatched.has(nodeId) || matched.toMatched.has(nodeId)) {
      return;
    }

    const fromOverride = fromEvaluated.nodeOverrides[nodeId];
    const toOverride = toEvaluated.nodeOverrides[nodeId];

    if (fromOverride && !toOverride) {
      nodeOverrides[nodeId] = {
        ...fromOverride,
        opacity: toFiniteNumber(fromOverride.opacity, nodes[nodeId]?.opacity ?? 1) * (1 - blendWeight),
      };
      return;
    }

    if (!fromOverride && toOverride) {
      nodeOverrides[nodeId] = {
        ...toOverride,
        opacity: toFiniteNumber(toOverride.opacity, nodes[nodeId]?.opacity ?? 1) * blendWeight,
      };
      return;
    }

    nodeOverrides[nodeId] = blendNodeOverrides(
      fromOverride,
      toOverride,
      blendWeight,
      nodes[nodeId],
      nodes[nodeId],
      pathMorphPlans?.[createPathMorphPlanKey(nodeId, nodeId)],
    );
  });

  return {
    frame: fromEvaluated.frame + (toEvaluated.frame - fromEvaluated.frame) * blendWeight,
    source: 'state-machine',
    nodeOverrides,
    unsupported: [
      ...(fromEvaluated.unsupported ?? []),
      ...(toEvaluated.unsupported ?? []),
    ],
  };
}

function getStateMap(layer) {
  return new Map(layer.states.map((state) => [state.id, state]));
}

function advanceLayer(document, machine, layer, runtime, paramValues, nodes, deltaFrames) {
  const stateMap = getStateMap(layer);
  const fallbackState = getLayerDefaultState(layer);
  const currentState = (runtime?.currentStateId ? stateMap.get(runtime.currentStateId) : null) ?? fallbackState;
  let nextParamValues = paramValues;

  if (!currentState) {
    return {
      runtime: null,
      paramValues,
    };
  }

  const safeDeltaFrames = Math.max(0, deltaFrames);
  const currentFrame = Math.max(0, runtime?.stateFrame ?? 0);
  let activeTransition = resolveActiveTransition(stateMap, runtime);

  if (!activeTransition) {
    const selected = selectTransition(document, layer, currentState, currentFrame, paramValues);

    nextParamValues = consumeTransitionConditions(machine, layer, selected, paramValues);

    if (selected) {
      const targetState = stateMap.get(selected.toStateId);
      const durationFrames = Math.max(0, Math.round(selected.durationFrames || 0));

      if (targetState && durationFrames <= 0) {
        return {
          runtime: {
            currentStateId: targetState.id,
            stateFrame: advanceStateFrame(document, targetState, 0, safeDeltaFrames),
            transition: null,
          },
          paramValues: nextParamValues,
        };
      }

      if (targetState) {
        activeTransition = {
          transitionId: selected.id,
          fromStateId: currentState.id,
          toStateId: targetState.id,
          elapsedFrames: 0,
          durationFrames,
          effect: normalizeTransitionEffect(selected.effect),
          fromFrame: currentFrame,
          toFrame: 0,
          pathMorphPlans: createStateMachineTransitionPathMorphPlans(
            document,
            currentState,
            targetState,
            nodes,
            currentFrame,
            0,
          ),
        };
      }
    }
  }

  if (activeTransition) {
    const targetState = stateMap.get(activeTransition.toStateId) ?? currentState;
    const durationFrames = Math.max(0, activeTransition.durationFrames);

    if (durationFrames <= 0) {
      return {
        runtime: {
          currentStateId: targetState.id,
          stateFrame: advanceStateFrame(document, targetState, 0, safeDeltaFrames),
          transition: null,
        },
        paramValues: nextParamValues,
      };
    }

    const remainingFrames = Math.max(0, durationFrames - activeTransition.elapsedFrames);
    const consumedFrames = Math.min(safeDeltaFrames, remainingFrames);
    const elapsedFrames = activeTransition.elapsedFrames + consumedFrames;

    if (elapsedFrames >= durationFrames) {
      const leftoverFrames = Math.max(0, safeDeltaFrames - consumedFrames);

      return {
        runtime: {
          currentStateId: targetState.id,
          stateFrame: resolveCompletedTransitionTargetFrame(
            document,
            targetState,
            activeTransition,
            elapsedFrames,
            leftoverFrames,
          ),
          transition: null,
        },
        paramValues: nextParamValues,
      };
    }

    return {
      runtime: {
        currentStateId: activeTransition.fromStateId,
        stateFrame: activeTransition.fromFrame ?? currentFrame,
        transition: {
          ...activeTransition,
          elapsedFrames,
        },
      },
      paramValues: nextParamValues,
    };
  }

  return {
    runtime: {
      currentStateId: currentState.id,
      stateFrame: advanceStateFrame(document, currentState, currentFrame, safeDeltaFrames),
      transition: null,
    },
    paramValues,
  };
}

function evaluateLayer(document, layer, layerRuntime, nodes) {
  const stateMap = getStateMap(layer);
  const transition = resolveActiveTransition(stateMap, layerRuntime);

  if (transition) {
    const fromState = stateMap.get(transition.fromStateId);
    const toState = stateMap.get(transition.toStateId);

    if (fromState && toState) {
      const effect = normalizeTransitionEffect(transition.effect);
      const fromEvaluated = evaluateClipAtFrame(document, fromState.clipId, transition.fromFrame ?? layerRuntime.stateFrame, nodes);
      const toFrame = effect.targetFramePolicy === 'current-frame'
        ? (transition.toFrame ?? 0) + transition.elapsedFrames
        : transition.toFrame ?? 0;
      const toEvaluated = evaluateClipAtFrame(document, toState.clipId, toFrame, nodes);
      const weight = transition.durationFrames > 0
        ? clamp(transition.elapsedFrames / transition.durationFrames, 0, 1)
        : 1;

      return blendEvaluatedStates(fromEvaluated, toEvaluated, weight, nodes, effect, transition.pathMorphPlans);
    }
  }

  const state = stateMap.get(layerRuntime?.currentStateId) ?? getLayerDefaultState(layer);

  if (!state) {
    return { frame: 0, source: 'none', nodeOverrides: {}, unsupported: [] };
  }

  return evaluateClipAtFrame(document, state.clipId, layerRuntime?.stateFrame ?? 0, nodes);
}

function getNodeMatchKey(node) {
  return node?.transitionMatchKey?.trim() || node?.name?.trim() || node?.id || '';
}

function getStateMachineLayerRole(document, layer) {
  if (layer.control || layer.layerRole === 'control') {
    return 'control';
  }

  if (layer.layerRole === 'motion' || layer.layerRole === 'overlay') {
    return layer.layerRole;
  }

  const roles = layer.states
    .map((state) => document.clips[state.clipId]?.stateAnim?.layerRole)
    .filter(Boolean);

  if (roles.length > 0 && roles.every((role) => role === 'control')) {
    return 'control';
  }

  if (roles.length > 0 && roles.every((role) => role === 'overlay')) {
    return 'overlay';
  }

  return 'motion';
}

function getStateMachineLayerPriority(layer) {
  const layerPriority = Number(layer.priority);

  if (Number.isFinite(layerPriority)) {
    return layerPriority;
  }

  return toFiniteNumber(layer.control?.priority, 0);
}

function getStateMachineLayersForComposition(machine) {
  return [...machine.layers].reverse();
}

function getLayerCompositionTieRank(composition) {
  return composition === 'control' ? 1 : 0;
}

function compareLayerCompositionEntries(left, right) {
  return left.priority - right.priority ||
    getLayerCompositionTieRank(left.composition) - getLayerCompositionTieRank(right.composition) ||
    left.order - right.order;
}

function getStateMachineLayerNodeScope(document, layer) {
  const nodeIds = new Set();
  let hasScopedNodes = false;

  layer.states.forEach((state) => {
    const clip = document.clips[state.clipId];
    const explicitLayerNodeIds = clip?.stateAnim?.layerNodeIds ?? [];
    const activeNodeIds = getClipActiveNodeIds(clip);

    if (explicitLayerNodeIds.length > 0) {
      hasScopedNodes = true;
      explicitLayerNodeIds.forEach((nodeId) => nodeIds.add(nodeId));
    }

    if (activeNodeIds.size > 0) {
      hasScopedNodes = true;
      activeNodeIds.forEach((nodeId) => nodeIds.add(nodeId));
    }
  });

  return hasScopedNodes ? nodeIds : null;
}

function getStateClipActiveNodeScope(document, state, nodeScope) {
  const scopedNodeIds = new Set();

  getClipActiveNodeIds(document.clips[state.clipId]).forEach((nodeId) => {
    if (!nodeScope || nodeScope.has(nodeId)) {
      scopedNodeIds.add(nodeId);
    }
  });

  return scopedNodeIds;
}

function createNodeMatchIndex(nodes, nodeIds) {
  const index = new Map();

  Array.from(nodeIds).forEach((nodeId) => {
    const matchKey = getNodeMatchKey(nodes[nodeId]);

    if (!matchKey) {
      return;
    }

    const indexedNodeIds = index.get(matchKey) ?? [];

    indexedNodeIds.push(nodeId);
    index.set(matchKey, indexedNodeIds);
  });

  return index;
}

function mergeNodeOverride(target, nodeId, override) {
  target[nodeId] = {
    ...(target[nodeId] ?? {}),
    ...override,
  };
}

function hasControlProperty(config, property) {
  return (config.properties ?? []).includes(property);
}

function assignProjectedControlOverride(target, targetNodeId, sourceOverride, control) {
  const patch = {};
  const projectedProperties = [];

  if (hasControlProperty(control, 'transform')) {
    let hasTransformPatch = false;

    TRANSFORM_PROPERTY_KEYS.forEach((key) => {
      if (typeof sourceOverride[key] === 'number') {
        patch[key] = sourceOverride[key];
        hasTransformPatch = true;
      }
    });

    if (hasTransformPatch) {
      projectedProperties.push('transform');
    }
  }

  if (hasControlProperty(control, 'opacity') && typeof sourceOverride.opacity === 'number') {
    patch.opacity = clamp(sourceOverride.opacity, 0, 1);
    projectedProperties.push('opacity');
  }

  if (hasControlProperty(control, 'fill') && typeof sourceOverride.fill === 'string') {
    patch.fill = normalizeHexColor(sourceOverride.fill, '#000000');
    projectedProperties.push('fill');
  }

  if (hasControlProperty(control, 'stroke') && typeof sourceOverride.stroke === 'string') {
    patch.stroke = normalizeHexColor(sourceOverride.stroke, '#000000');
    projectedProperties.push('stroke');
  }

  if (hasControlProperty(control, 'path') && sourceOverride.path) {
    patch.path = sourceOverride.path;
    projectedProperties.push('path');
  }

  if (hasControlProperty(control, 'revealPath') && sourceOverride.revealPath) {
    patch.revealPath = sourceOverride.revealPath;
    projectedProperties.push('revealPath');
  }

  if (Object.keys(patch).length === 0) {
    return [];
  }

  target[targetNodeId] = {
    ...(target[targetNodeId] ?? {}),
    ...patch,
  };

  return projectedProperties;
}

function applyControlLayerProjection(sourceOverrides, targetNodeIds, nodes, control, target) {
  const sourceIndex = createNodeMatchIndex(nodes, Object.keys(sourceOverrides));
  const targetIndex = createNodeMatchIndex(nodes, targetNodeIds);
  const projectedPropertyCounts = {};
  const unmatchedSourceKeys = [];
  const unmatchedTargetKeys = [];
  let matchedCount = 0;
  let sourceOnlyCount = 0;
  let targetOnlyCount = 0;

  sourceIndex.forEach((sourceNodeIds, matchKey) => {
    const matchedTargetNodeIds = targetIndex.get(matchKey) ?? [];

    if (sourceNodeIds.length === 0 || matchedTargetNodeIds.length === 0) {
      return;
    }

    matchedCount += matchedTargetNodeIds.length;

    for (let index = 0; index < matchedTargetNodeIds.length; index += 1) {
      const sourceNodeId = sourceNodeIds[index % sourceNodeIds.length];
      const targetNodeId = matchedTargetNodeIds[index];

      if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) {
        continue;
      }

      const projectedProperties = assignProjectedControlOverride(
        target,
        targetNodeId,
        sourceOverrides[sourceNodeId] ?? {},
        control,
      );

      projectedProperties.forEach((property) => {
        projectedPropertyCounts[property] = (projectedPropertyCounts[property] ?? 0) + 1;
      });
    }
  });

  sourceIndex.forEach((sourceNodeIds, matchKey) => {
    const matchedTargetNodeIds = targetIndex.get(matchKey) ?? [];

    if (matchedTargetNodeIds.length === 0) {
      sourceOnlyCount += sourceNodeIds.length;
      unmatchedSourceKeys.push(matchKey);
    } else if (sourceNodeIds.length > matchedTargetNodeIds.length) {
      sourceOnlyCount += sourceNodeIds.length - matchedTargetNodeIds.length;
      unmatchedSourceKeys.push(matchKey);
    }
  });

  targetIndex.forEach((matchedTargetNodeIds, matchKey) => {
    const sourceNodeIds = sourceIndex.get(matchKey) ?? [];

    if (sourceNodeIds.length === 0) {
      targetOnlyCount += matchedTargetNodeIds.length;
      unmatchedTargetKeys.push(matchKey);
    }
  });

  return {
    matchedCount,
    sourceOnlyCount,
    targetOnlyCount,
    projectedPropertyCounts,
    unmatchedSourceKeys,
    unmatchedTargetKeys,
  };
}

function evaluateStateMachine(document, machineId, runtime, nodes) {
  const machine = document.stateMachines[machineId];
  const nodeOverrides = {};
  const unsupported = [];
  const controlLayerProjections = [];
  const layerCompositionEntries = [];
  const controlProjectionReports = [];
  const allVisibleTargetNodeIds = new Set();
  const visibleMotionNodeIds = new Set();
  const visibleTargetNodeIdsByLayerId = new Map();
  const safeRuntime = machine && runtime?.machineId === machine.id ? runtime : machine ? createStateMachineRuntime(machine) : null;

  if (!machine || !safeRuntime) {
    return { frame: 0, source: 'none', nodeOverrides, unsupported };
  }

  machine.layers.forEach((layer) => {
    layer.states.forEach((state) => {
      getClipActiveNodeIds(document.clips[state.clipId]).forEach((nodeId) => {
        if (nodes[nodeId]) {
          nodeOverrides[nodeId] = { opacity: 0 };
        }
      });
    });
  });

  const addVisibleProjectionTargets = (layer, layerComposition, state, nodeScope) => {
    if (layerComposition === 'control' || !state) {
      return;
    }

    const layerTargetIds = visibleTargetNodeIdsByLayerId.get(layer.id) ?? new Set();

    getStateClipActiveNodeScope(document, state, nodeScope).forEach((nodeId) => {
      layerTargetIds.add(nodeId);
      allVisibleTargetNodeIds.add(nodeId);

      if (layerComposition === 'motion') {
        visibleMotionNodeIds.add(nodeId);
      }
    });

    visibleTargetNodeIdsByLayerId.set(layer.id, layerTargetIds);
  };

  getStateMachineLayersForComposition(machine).forEach((layer, layerIndex) => {
    const layerRuntime = safeRuntime.layers[layer.id];
    const stateMap = getStateMap(layer);
    const currentState = (layerRuntime?.currentStateId ? stateMap.get(layerRuntime.currentStateId) : null) ?? getLayerDefaultState(layer);
    const layerNodeScope = getStateMachineLayerNodeScope(document, layer);
    const layerComposition = getStateMachineLayerRole(document, layer);
    const layerPriority = getStateMachineLayerPriority(layer);
    const evaluated = evaluateLayer(document, layer, layerRuntime, nodes);
    const activeTransition = resolveActiveTransition(stateMap, layerRuntime);

    unsupported.push(...(evaluated.unsupported ?? []));

    if (!currentState) {
      unsupported.push({
        code: 'state-machine-layer-empty',
        message: `State Machine layer ${layer.name} has no states`,
      });
      return;
    }

    if (activeTransition) {
      addVisibleProjectionTargets(layer, layerComposition, stateMap.get(activeTransition.fromStateId), layerNodeScope);
      addVisibleProjectionTargets(layer, layerComposition, stateMap.get(activeTransition.toStateId), layerNodeScope);
    } else {
      addVisibleProjectionTargets(layer, layerComposition, currentState, layerNodeScope);
    }

    if (layerComposition === 'control') {
      controlLayerProjections.push({
        layer,
        overrides: evaluated.nodeOverrides,
        order: layerIndex,
        priority: layerPriority,
      });
      return;
    }

    layerCompositionEntries.push({
      layer,
      overrides: evaluated.nodeOverrides,
      order: layerIndex,
      priority: layerPriority,
      composition: layerComposition,
    });
  });

  controlLayerProjections
    .sort((left, right) => left.priority - right.priority || left.order - right.order)
    .forEach(({ layer, overrides, order, priority }) => {
      const control = layer.control;

      if (!control || !Array.isArray(control.properties) || control.properties.length === 0) {
        unsupported.push({
          code: 'state-machine-control-config-missing',
          message: `State Machine control layer ${layer.name} 缺少 control.properties`,
        });
        return;
      }

      const targetLayer = control.targetLayerId
        ? machine.layers.find((item) => item.id === control.targetLayerId) ?? null
        : null;
      const targetScope = control.targetScope ?? 'active-motion';
      const targetNodeIds = targetScope === 'all-visible'
        ? allVisibleTargetNodeIds
        : control.targetLayerId
          ? visibleTargetNodeIdsByLayerId.get(control.targetLayerId) ?? new Set()
          : visibleMotionNodeIds;

      if (targetNodeIds.size === 0) {
        unsupported.push({
          code: 'state-machine-control-target-empty',
          message: `State Machine control layer ${layer.name} 没有可投射的目标节点`,
        });
        return;
      }

      const projectedOverrides = {};
      const projectionResult = applyControlLayerProjection(overrides, targetNodeIds, nodes, control, projectedOverrides);

      layerCompositionEntries.push({
        layer,
        overrides: projectedOverrides,
        order,
        priority,
        composition: 'control',
      });

      controlProjectionReports.push({
        layerId: layer.id,
        layerName: layer.name,
        ...(targetLayer ? { targetLayerId: targetLayer.id, targetLayerName: targetLayer.name } : {}),
        targetScope,
        properties: control.properties,
        matchedCount: projectionResult.matchedCount,
        sourceOnlyCount: projectionResult.sourceOnlyCount,
        targetOnlyCount: projectionResult.targetOnlyCount,
        projectedPropertyCounts: projectionResult.projectedPropertyCounts,
        unmatchedSourceKeys: projectionResult.unmatchedSourceKeys,
        unmatchedTargetKeys: projectionResult.unmatchedTargetKeys,
      });
    });

  layerCompositionEntries
    .sort(compareLayerCompositionEntries)
    .forEach(({ overrides }) => {
      Object.entries(overrides).forEach(([nodeId, override]) => {
        mergeNodeOverride(nodeOverrides, nodeId, override);
      });
    });

  return {
    frame: Math.max(0, ...Object.values(safeRuntime.layers ?? {}).map((layerRuntime) =>
      layerRuntime?.transition?.elapsedFrames ?? layerRuntime?.stateFrame ?? 0)),
    source: 'state-machine',
    nodeOverrides,
    stateMachineControlProjections: controlProjectionReports,
    unsupported,
  };
}

function advanceStateMachine(document, machineId, runtime, paramValues, nodes, deltaFrames) {
  const machine = document.stateMachines[machineId];

  if (!machine) {
    return {
      runtime,
      paramValues: paramValues ?? {},
      evaluated: { frame: 0, source: 'none', nodeOverrides: {}, unsupported: [] },
    };
  }

  let nextParamValues = createParamValues(machine, paramValues);
  const currentRuntime = runtime?.machineId === machine.id ? runtime : createStateMachineRuntime(machine);
  const nextRuntime = {
    machineId: machine.id,
    layers: {},
  };

  machine.layers.forEach((layer) => {
    const advanced = advanceLayer(
      document,
      machine,
      layer,
      currentRuntime.layers[layer.id],
      nextParamValues,
      nodes,
      Math.max(0, deltaFrames),
    );

    if (advanced.runtime) {
      nextRuntime.layers[layer.id] = advanced.runtime;
    }

    nextParamValues = advanced.paramValues;
  });

  return {
    runtime: nextRuntime,
    paramValues: nextParamValues,
    evaluated: evaluateStateMachine(document, machine.id, nextRuntime, nodes),
  };
}

const elements = {
  fileInput: document.querySelector('#fileInput'),
  playToggleBtn: document.querySelector('#playToggleBtn'),
  stepBtn: document.querySelector('#stepBtn'),
  resetBtn: document.querySelector('#resetBtn'),
  interruptBtn: document.querySelector('#interruptBtn'),
  speedInput: document.querySelector('#speedInput'),
  speedOutput: document.querySelector('#speedOutput'),
  layerStatePanel: document.querySelector('#layerStatePanel'),
  logBox: document.querySelector('#logBox'),
  avatarStage: document.querySelector('#avatarStage'),
  stageStatus: document.querySelector('#stageStatus'),
  runtimeBox: document.querySelector('#runtimeBox'),
  paramPanel: document.querySelector('#paramPanel'),
};

function createElement(tagName, className = '') {
  const element = document.createElement(tagName);

  if (className) {
    element.className = className;
  }

  return element;
}

function createSvgElement(tagName) {
  return document.createElementNS(SVG_NS, tagName);
}

function writeLog(message) {
  const timestamp = new Date().toLocaleTimeString();
  elements.logBox.textContent = `${elements.logBox.textContent}\n[${timestamp}] ${message}`.trim();
  elements.logBox.scrollTop = elements.logBox.scrollHeight;
}

function setStageStatus(message) {
  elements.stageStatus.textContent = message;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function toFiniteNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeId(value, fallback) {
  const raw = String(value ?? fallback ?? 'item').trim();
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || String(fallback ?? `item-${Date.now()}`);
}

function normalizeHexColor(value, fallback = '#000000') {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();

  if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const [, r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }

  return fallback;
}

function dirname(path) {
  const index = path.lastIndexOf('/');
  return index >= 0 ? path.slice(0, index + 1) : '';
}

function joinUrl(baseUrl, relativeUrl) {
  if (/^(https?:)?\/\//.test(relativeUrl) || relativeUrl.startsWith('/')) {
    return relativeUrl;
  }

  return new URL(relativeUrl, window.location.origin + baseUrl).pathname;
}

function joinPath(basePath, relativePath) {
  const parts = `${basePath}${relativePath}`.split('/');
  const stack = [];

  parts.forEach((part) => {
    if (!part || part === '.') {
      return;
    }

    if (part === '..') {
      stack.pop();
      return;
    }

    stack.push(part);
  });

  return stack.join('/');
}

async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`加载失败 ${response.status}: ${url}`);
  }

  return response.json();
}

function readStoredZipEntries(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const decoder = new TextDecoder();
  const entries = new Map();
  let offset = 0;

  while (offset + 30 <= bytes.length) {
    const signature = view.getUint32(offset, true);

    if (signature === 0x02014b50 || signature === 0x06054b50) {
      break;
    }

    if (signature !== 0x04034b50) {
      offset += 1;
      continue;
    }

    const compressionMethod = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const fileNameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const fileNameStart = offset + 30;
    const fileNameEnd = fileNameStart + fileNameLength;
    const dataStart = fileNameEnd + extraLength;
    const dataEnd = dataStart + compressedSize;

    if (fileNameEnd > bytes.length || dataEnd > bytes.length) {
      break;
    }

    const name = decoder.decode(bytes.slice(fileNameStart, fileNameEnd)).replace(/^\/+/, '');

    if (!name.endsWith('/')) {
      if (compressionMethod !== 0) {
        throw new Error(`Zip 内文件使用了压缩方式 ${compressionMethod}，当前 lab 仅支持 store 导出的 zip。`);
      }

      const data = bytes.slice(dataStart, dataEnd);
      entries.set(name, {
        bytes: data,
        text: () => decoder.decode(data),
        json: () => JSON.parse(decoder.decode(data)),
      });
    }

    offset = dataEnd;
  }

  return entries;
}

function findDescriptorEntry(entries) {
  const preferred = [
    'state-anim.json',
    'state-animation.json',
    'index.json',
    'manifest.json',
  ];

  for (const name of preferred) {
    if (entries.has(name)) {
      return name;
    }
  }

  return [...entries.keys()].find((name) => name.endsWith('/state-anim.json'))
    ?? [...entries.keys()].find((name) => name.endsWith('.json') && /state-?anim/i.test(name))
    ?? [...entries.keys()].find((name) => name.endsWith('.json'));
}

function looksLikeStateAnimDescriptor(value) {
  return Boolean(value && typeof value === 'object' && Array.isArray(value.variants));
}

function getIndexDescriptorRef(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.templates)) {
    return '';
  }

  const template = value.templates.find((item) => typeof item?.descriptor === 'string' && item.descriptor.trim())
    ?? value.templates[0];

  return typeof template?.descriptor === 'string' ? template.descriptor.trim() : '';
}

async function resolveStateAnimDescriptor(value, source) {
  if (looksLikeStateAnimDescriptor(value)) {
    return { descriptor: value, source };
  }

  const descriptorRef = getIndexDescriptorRef(value);

  if (!descriptorRef) {
    return { descriptor: value, source };
  }

  if (source.type === 'zip') {
    const descriptorPath = joinPath(dirname(source.descriptorPath ?? ''), descriptorRef);
    const entry = source.entries.get(descriptorPath) ?? source.entries.get(descriptorRef);

    if (!entry) {
      throw new Error(`Zip 中找不到 index 指向的 descriptor: ${descriptorRef}`);
    }

    return {
      descriptor: entry.json(),
      source: {
        ...source,
        descriptorPath,
      },
    };
  }

  if (source.type === 'url') {
    const descriptorUrl = joinUrl(dirname(source.url), descriptorRef);

    return {
      descriptor: await fetchJson(descriptorUrl),
      source: {
        ...source,
        url: descriptorUrl,
      },
    };
  }

  throw new Error('当前 JSON 是 state anim index，但本地文件无法自动读取相对 descriptor，请选择 descriptor JSON 或 zip。');
}

function normalizeLayerInitial(rawInitial) {
  const initial = {};

  if (!rawInitial || typeof rawInitial !== 'object' || Array.isArray(rawInitial)) {
    return initial;
  }

  Object.entries(rawInitial).forEach(([rawProperty, value]) => {
    const property = PROPERTY_MAP[rawProperty] ?? rawProperty;

    if (KNOWN_PROPERTIES.has(property)) {
      initial[property] = value;
    }
  });

  return initial;
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeLayerBounds(value) {
  const record = asRecord(value);
  const width = toFiniteNumber(record.width, 0);
  const height = toFiniteNumber(record.height, 0);

  if (width <= 0 || height <= 0) {
    return undefined;
  }

  return {
    x: toFiniteNumber(record.x, 0),
    y: toFiniteNumber(record.y, 0),
    width,
    height,
  };
}

function normalizeStrokePosition(value) {
  return value === 'inside' || value === 'outside' || value === 'center' ? value : undefined;
}

function normalizeCornerRadii(value) {
  const record = asRecord(value);
  const cornerRadii = {};

  ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'].forEach((key) => {
    const numeric = Number(record[key]);

    if (Number.isFinite(numeric)) {
      cornerRadii[key] = Math.max(0, numeric);
    }
  });

  return Object.keys(cornerRadii).length > 0 ? cornerRadii : undefined;
}

function normalizeFrameLayerDef(value) {
  const record = asRecord(value);

  if (Object.keys(record).length === 0) {
    return undefined;
  }

  const frameDef = {};
  const cornerRadii = normalizeCornerRadii(record.cornerRadii);
  const strokePosition = normalizeStrokePosition(record.strokePosition);

  if (typeof record.clipContent === 'boolean') frameDef.clipContent = record.clipContent;
  if (typeof record.fill === 'string') frameDef.fill = record.fill;
  if (Number.isFinite(Number(record.fillOpacity))) frameDef.fillOpacity = toFiniteNumber(record.fillOpacity, 1);
  if (typeof record.fillVisible === 'boolean') frameDef.fillVisible = record.fillVisible;
  if (typeof record.stroke === 'string' || record.stroke === null) frameDef.stroke = record.stroke;
  if (Number.isFinite(Number(record.strokeOpacity))) frameDef.strokeOpacity = toFiniteNumber(record.strokeOpacity, 1);
  if (typeof record.strokeVisible === 'boolean') frameDef.strokeVisible = record.strokeVisible;
  if (Number.isFinite(Number(record.strokeWidth))) frameDef.strokeWidth = Math.max(0, toFiniteNumber(record.strokeWidth, 0));
  if (strokePosition) frameDef.strokePosition = strokePosition;
  if (Number.isFinite(Number(record.radius))) frameDef.radius = Math.max(0, toFiniteNumber(record.radius, 0));
  if (cornerRadii) frameDef.cornerRadii = cornerRadii;

  return Object.keys(frameDef).length > 0 ? frameDef : undefined;
}

function normalizeLayerDef(rawLayerDef, index) {
  const raw = rawLayerDef && typeof rawLayerDef === 'object' ? rawLayerDef : {};
  const motionKey = String(raw.motionKey ?? raw.id ?? `layer-${index + 1}`);
  const initial = normalizeLayerInitial(raw.initial);
  const bounds = normalizeLayerBounds(raw.bounds);
  const frame = normalizeFrameLayerDef(raw.frame);

  return {
    id: String(raw.id ?? motionKey),
    label: String(raw.label ?? raw.name ?? motionKey),
    motionKey,
    transitionMatchKey: String(raw.transitionMatchKey ?? raw.label ?? raw.name ?? motionKey),
    kind: String(raw.kind ?? raw.type ?? 'shape').toLowerCase(),
    partIndexes: Array.isArray(raw.partIndexes)
      ? raw.partIndexes
          .map((partIndex) => Math.max(0, Math.round(toFiniteNumber(partIndex, 0))))
          .filter((partIndex, partIndexIndex, list) => list.indexOf(partIndex) === partIndexIndex)
      : [],
    ...(Object.keys(initial).length > 0 ? { initial } : {}),
    ...(bounds ? { bounds } : {}),
    ...(frame ? { frame } : {}),
    ...(typeof raw.parentMotionKey === 'string' && raw.parentMotionKey.trim()
      ? { parentMotionKey: raw.parentMotionKey.trim() }
      : {}),
  };
}

function normalizeCompiledMotion(rawMotion) {
  const motion = rawMotion && typeof rawMotion === 'object' ? rawMotion : {};
  const layers = motion.layers && typeof motion.layers === 'object' ? motion.layers : {};
  const layerDefs = Array.isArray(motion.layerDefs)
    ? motion.layerDefs.map(normalizeLayerDef)
    : Object.keys(layers).map((motionKey) => ({
      id: motionKey,
      label: motionKey,
      motionKey,
      transitionMatchKey: motionKey,
      kind: 'shape',
      partIndexes: [],
    }));

  return {
    ...motion,
    fps: Math.max(1, Math.round(toFiniteNumber(motion.fps, 30))),
    frames: Math.max(1, Math.round(toFiniteNumber(motion.frames, 1))),
    base: {
      width: Math.max(1, toFiniteNumber(motion.base?.width, 640)),
      height: Math.max(1, toFiniteNumber(motion.base?.height, 640)),
      centerX: toFiniteNumber(motion.base?.centerX, toFiniteNumber(motion.base?.width, 640) / 2),
      centerY: toFiniteNumber(motion.base?.centerY, toFiniteNumber(motion.base?.height, 640) / 2),
    },
    layerDefs: layerDefs.filter((layerDef) => layerDef.motionKey),
    layers,
  };
}

function normalizeKeyframes(rawKeyframes, property, transformValue = (item) => item) {
  if (!Array.isArray(rawKeyframes)) {
    return [];
  }

  return rawKeyframes
    .map((rawKeyframe, index) => {
      if (Array.isArray(rawKeyframe)) {
        const [frame, value, easing = 'linear'] = rawKeyframe;

        return {
          id: `${property}-${index}`,
          frame: Math.max(0, toFiniteNumber(frame, 0)),
          value: transformValue(value, property),
          easing,
        };
      }

      if (rawKeyframe && typeof rawKeyframe === 'object') {
        if (rawKeyframe.source === STATIC_COMPILED_KEYFRAME_SOURCE) {
          return null;
        }

        return {
          id: String(rawKeyframe.id ?? `${property}-${index}`),
          frame: Math.max(0, toFiniteNumber(rawKeyframe.frame, 0)),
          value: transformValue(rawKeyframe.value, property),
          easing: rawKeyframe.easing ?? 'linear',
        };
      }

      return null;
    })
    .filter(Boolean)
    .sort((left, right) => left.frame - right.frame);
}

function normalizeChannels(rawChannels, transformValue = (item) => item) {
  const channels = {};

  Object.entries(rawChannels ?? {}).forEach(([rawProperty, rawKeyframes]) => {
    const property = PROPERTY_MAP[rawProperty] ?? rawProperty;
    const keyframes = normalizeKeyframes(rawKeyframes, property, transformValue);

    if (keyframes.length > 0) {
      channels[property] = keyframes;
    }
  });

  return channels;
}

function getFirstKeyframeValue(channels, property, fallback) {
  const keyframe = channels[property]?.[0];
  return keyframe ? keyframe.value : fallback;
}

function getLayerNodeId(layerDef) {
  return layerDef.motionKey || layerDef.id;
}

function isGroupLayerDef(layerDef) {
  return String(layerDef.kind ?? '').toLowerCase() === 'group';
}

function isFrameLayerDef(layerDef) {
  return String(layerDef.kind ?? '').toLowerCase() === 'frame';
}

function isContainerLayerDef(layerDef) {
  return isGroupLayerDef(layerDef) || isFrameLayerDef(layerDef);
}

function getLayerDefSize(layerDef, motion, fallbackSize) {
  return {
    width: Math.max(1, toFiniteNumber(layerDef.bounds?.width, fallbackSize?.width ?? motion.base.width)),
    height: Math.max(1, toFiniteNumber(layerDef.bounds?.height, fallbackSize?.height ?? motion.base.height)),
  };
}

function getMotionFacePart(descriptor, motion, partIndex) {
  if (!Number.isFinite(partIndex)) {
    return undefined;
  }

  return motion?.templateResource?.faceParts?.[partIndex] ?? descriptor.faceParts?.[partIndex];
}

function getLayerFaceParts(descriptor, motion, layerDef) {
  const partIndexes = Array.isArray(layerDef.partIndexes) ? layerDef.partIndexes : [];
  return partIndexes.map((partIndex) => getMotionFacePart(descriptor, motion, partIndex));
}

function getMotionLayerDef(motion, motionKey) {
  return motion.layerDefs.find((layerDef) => getLayerNodeId(layerDef) === motionKey) ?? null;
}

function getRawLayerChannels(motion, layerDef) {
  const nodeId = getLayerNodeId(layerDef);
  return motion.layers?.[nodeId] ?? motion.layers?.[layerDef.id] ?? {};
}

function getFirstRawKeyframeValue(rawChannels, property) {
  const rawKeyframes = rawChannels?.[property];
  const rawKeyframe = Array.isArray(rawKeyframes) ? rawKeyframes[0] : null;

  if (Array.isArray(rawKeyframe)) {
    return rawKeyframe[1];
  }

  if (rawKeyframe && typeof rawKeyframe === 'object' && rawKeyframe.source !== STATIC_COMPILED_KEYFRAME_SOURCE) {
    return rawKeyframe.value;
  }

  return undefined;
}

function getFirstLayerValue(motion, layerDef, property, fallback) {
  const rawChannels = getRawLayerChannels(motion, layerDef);
  const rawValue = getFirstRawKeyframeValue(rawChannels, property);

  if (rawValue !== undefined) {
    return rawValue;
  }

  if (layerDef.initial && layerDef.initial[property] !== undefined) {
    return layerDef.initial[property];
  }

  return fallback;
}

function getPathPointBounds(path) {
  const xs = [];
  const ys = [];

  (path?.points ?? []).forEach((point) => {
    if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
      xs.push(point.x);
      ys.push(point.y);
    }

    ['in', 'out'].forEach((handleKey) => {
      const handle = point[handleKey];

      if (handle && Number.isFinite(handle.x) && Number.isFinite(handle.y)) {
        xs.push(point.x + handle.x);
        ys.push(point.y + handle.y);
      }
    });
  });

  if (xs.length === 0 || ys.length === 0) {
    return null;
  }

  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

function getLayerPathSource(motion, layerDef, firstPart) {
  const motionPathValue = getFirstLayerValue(motion, layerDef, 'path', undefined);

  return getPathOverrideData(motionPathValue) || firstPart?.d || '';
}

function getPathPositionOffset(pathData) {
  const parsedPath = getPathOperationValue(parseSvgPathDataResult(pathData));
  const bounds = getPathPointBounds(parsedPath);

  return bounds ? { x: bounds.x, y: bounds.y } : { x: 0, y: 0 };
}

function translatePathData(pathData, delta) {
  const source = getPathOverrideData(pathData);

  if (!source || (delta.x === 0 && delta.y === 0)) {
    return source;
  }

  return getPathOperationValue(translateSvgPathDataResult(source, delta)) ?? source;
}

function normalizeFacePartsWithOffset(parts, offset) {
  if (!offset || (offset.x === 0 && offset.y === 0)) {
    return parts;
  }

  return parts.map((part) => part?.d
    ? {
        ...part,
        d: translatePathData(part.d, { x: -offset.x, y: -offset.y }),
      }
    : part);
}

function getLayerAbsolutePosition(motion, layerDef, positionOffsetsByLayerKey = {}) {
  const nodeId = getLayerNodeId(layerDef);
  const offset = positionOffsetsByLayerKey[nodeId] ?? positionOffsetsByLayerKey[layerDef.motionKey] ?? { x: 0, y: 0 };

  return {
    x: toFiniteNumber(getFirstLayerValue(motion, layerDef, 'position.x', 0), 0) + offset.x,
    y: toFiniteNumber(getFirstLayerValue(motion, layerDef, 'position.y', 0), 0) + offset.y,
  };
}

function getParentLayerAbsolutePosition(motion, layerDef, positionOffsetsByLayerKey = {}) {
  const parentMotionKey = layerDef.parentMotionKey;
  const parentLayerDef = parentMotionKey ? getMotionLayerDef(motion, parentMotionKey) : null;

  return parentLayerDef ? getLayerAbsolutePosition(motion, parentLayerDef, positionOffsetsByLayerKey) : { x: 0, y: 0 };
}

function getLayerPositionOffset(layerDef, positionOffsetsByLayerKey = {}) {
  const nodeId = getLayerNodeId(layerDef);

  return positionOffsetsByLayerKey[nodeId] ?? positionOffsetsByLayerKey[layerDef.motionKey] ?? { x: 0, y: 0 };
}

function transformLayerValue(motion, layerDef, property, value, positionOffsetsByLayerKey = {}) {
  const offset = getLayerPositionOffset(layerDef, positionOffsetsByLayerKey);

  if (property === 'path') {
    return translatePathData(value, { x: -offset.x, y: -offset.y });
  }

  if (property !== 'position.x' && property !== 'position.y') {
    return value;
  }

  const axis = property === 'position.x' ? 'x' : 'y';
  const parentPosition = getParentLayerAbsolutePosition(motion, layerDef, positionOffsetsByLayerKey);

  return toFiniteNumber(value, 0) + offset[axis] - parentPosition[axis];
}

function getLayerBaseValue(motion, layerDef, property, fallback, positionOffsetsByLayerKey = {}) {
  return transformLayerValue(
    motion,
    layerDef,
    property,
    getFirstLayerValue(motion, layerDef, property, fallback),
    positionOffsetsByLayerKey,
  );
}

function createFillStyle(color, opacity = 1) {
  return {
    mode: 'solid',
    color,
    opacity,
    stops: [],
    handles: {
      start: { x: 0, y: 0 },
      end: { x: 1, y: 0 },
      center: { x: 0.5, y: 0.5 },
    },
  };
}

function createFrameNode(id, width, height, name) {
  return {
    id,
    type: 'frame',
    name,
    parentId: null,
    children: [],
    x: -width / 2,
    y: -height / 2,
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    fill: '#FFFFFF',
    fillOpacity: 1,
    fillVisible: true,
    fillStyle: createFillStyle('#FFFFFF', 1),
    stroke: null,
    strokeOpacity: 1,
    strokeVisible: false,
    strokeWidth: 0,
    strokePosition: 'center',
    radius: 0,
    cornerRadii: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
    clipContent: false,
  };
}

function createGroupNode(id, name, parentId, layerDef, motion, size, positionOffsetsByLayerKey = {}) {
  return {
    id,
    type: 'group',
    name,
    transitionMatchKey: layerDef.transitionMatchKey || name,
    parentId,
    children: [],
    x: toFiniteNumber(getLayerBaseValue(motion, layerDef, 'position.x', 0, positionOffsetsByLayerKey), 0),
    y: toFiniteNumber(getLayerBaseValue(motion, layerDef, 'position.y', 0, positionOffsetsByLayerKey), 0),
    width: size.width,
    height: size.height,
    rotation: toFiniteNumber(getLayerBaseValue(motion, layerDef, 'rotation', 0, positionOffsetsByLayerKey), 0),
    opacity: clamp(toFiniteNumber(getLayerBaseValue(motion, layerDef, 'opacity', 1, positionOffsetsByLayerKey), 1), 0, 1),
    visible: true,
    locked: false,
    blendMode: 'normal',
  };
}

function createLayerFrameNode(id, name, parentId, layerDef, motion, size, positionOffsetsByLayerKey = {}) {
  const frameDef = layerDef.frame ?? {};
  const fill = normalizeHexColor(frameDef.fill ?? '#FFFFFF', '#FFFFFF');
  const fillOpacity = clamp(toFiniteNumber(frameDef.fillOpacity, 0), 0, 1);
  const fillVisible = frameDef.fillVisible ?? fillOpacity > 0;
  const strokeWidth = Math.max(0, toFiniteNumber(frameDef.strokeWidth, 0));
  const stroke = typeof frameDef.stroke === 'string'
    ? normalizeHexColor(frameDef.stroke, fill)
    : null;
  const strokeVisible = frameDef.strokeVisible ?? Boolean(stroke && strokeWidth > 0);
  const radius = Math.max(0, toFiniteNumber(frameDef.radius, 0));

  return {
    id,
    type: 'frame',
    name,
    transitionMatchKey: layerDef.transitionMatchKey || name,
    parentId,
    children: [],
    x: toFiniteNumber(getLayerBaseValue(motion, layerDef, 'position.x', 0, positionOffsetsByLayerKey), 0),
    y: toFiniteNumber(getLayerBaseValue(motion, layerDef, 'position.y', 0, positionOffsetsByLayerKey), 0),
    width: size.width,
    height: size.height,
    rotation: toFiniteNumber(getLayerBaseValue(motion, layerDef, 'rotation', 0, positionOffsetsByLayerKey), 0),
    opacity: clamp(toFiniteNumber(getLayerBaseValue(motion, layerDef, 'opacity', 1, positionOffsetsByLayerKey), 1), 0, 1),
    visible: true,
    locked: false,
    blendMode: 'normal',
    fill,
    fillOpacity,
    fillVisible,
    fillStyle: createFillStyle(fill, fillOpacity),
    stroke,
    strokeOpacity: clamp(toFiniteNumber(frameDef.strokeOpacity, 1), 0, 1),
    strokeVisible,
    strokeWidth,
    strokePosition: frameDef.strokePosition ?? 'center',
    radius,
    cornerRadii: {
      topLeft: Math.max(0, toFiniteNumber(frameDef.cornerRadii?.topLeft, radius)),
      topRight: Math.max(0, toFiniteNumber(frameDef.cornerRadii?.topRight, radius)),
      bottomRight: Math.max(0, toFiniteNumber(frameDef.cornerRadii?.bottomRight, radius)),
      bottomLeft: Math.max(0, toFiniteNumber(frameDef.cornerRadii?.bottomLeft, radius)),
    },
    clipContent: frameDef.clipContent ?? true,
  };
}

function createVectorNode(id, name, parentId, channels, firstPart, size, layerDef, motion, positionOffsetsByLayerKey = {}) {
  const fill = normalizeHexColor(getFirstKeyframeValue(channels, 'fill', firstPart?.fill), '#000000');
  const strokeWidth = toFiniteNumber(firstPart?.strokeWidth, 0);
  const stroke = strokeWidth > 0
    ? normalizeHexColor(getFirstKeyframeValue(channels, 'stroke', firstPart?.stroke), '#000000')
    : null;

  return {
    id,
    type: 'vector',
    name,
    transitionMatchKey: layerDef.transitionMatchKey || name,
    parentId,
    children: [],
    x: toFiniteNumber(getLayerBaseValue(motion, layerDef, 'position.x', getFirstKeyframeValue(channels, 'position.x', 0), positionOffsetsByLayerKey), 0),
    y: toFiniteNumber(getLayerBaseValue(motion, layerDef, 'position.y', getFirstKeyframeValue(channels, 'position.y', 0), positionOffsetsByLayerKey), 0),
    width: size.width,
    height: size.height,
    rotation: toFiniteNumber(getLayerBaseValue(motion, layerDef, 'rotation', getFirstKeyframeValue(channels, 'rotation', 0), positionOffsetsByLayerKey), 0),
    opacity: clamp(toFiniteNumber(getLayerBaseValue(motion, layerDef, 'opacity', getFirstKeyframeValue(channels, 'opacity', 1), positionOffsetsByLayerKey), 1), 0, 1),
    visible: true,
    locked: false,
    points: [],
    closed: true,
    fill,
    fillOpacity: 1,
    fillVisible: true,
    fillStyle: createFillStyle(fill, 1),
    stroke,
    strokeOpacity: 1,
    strokeVisible: Boolean(stroke) && strokeWidth > 0,
    strokeWidth,
    strokePosition: 'center',
    strokeStyle: 'solid',
    strokeWidthProfile: 'uniform',
    strokeJoin: 'round',
    strokeMiterLimit: 4,
    revealPath: { lengthStart: 0, lengthEnd: 1, offset: 0 },
  };
}

function createClipFromMotion(record, motion, allNodeIds, artboardFrameId, positionOffsetsByLayerKey = {}) {
  const tracks = {};
  const layerUsage = {};

  motion.layerDefs.forEach((layerDef) => {
    const nodeId = getLayerNodeId(layerDef);
    const rawChannels = motion.layers?.[nodeId] ?? motion.layers?.[layerDef.id] ?? {};
    const channels = normalizeChannels(rawChannels, (value, property) =>
      transformLayerValue(motion, layerDef, property, value, positionOffsetsByLayerKey));

    tracks[nodeId] = {
      nodeId,
      channels,
    };
    layerUsage[nodeId] = true;
  });

  const activeNodeIds = Object.keys(layerUsage);

  return {
    id: record.clipId,
    name: record.name,
    artboardFrameId,
    timeline: {
      fps: motion.fps,
      durationFrames: motion.frames,
      loop: true,
    },
    tracks,
    layerUsage,
    mediaTracks: {},
    live2dParameters: {},
    modelParameters: {},
    stateAnim: {
      instanceId: record.clipId,
      templateId: record.templateId,
      stateId: record.stateId,
      stateMachineId: record.machineId,
      stateMachineLayerId: record.machineLayerId,
      stateMachineLayerName: record.machineLayerName,
      layerRole: record.layerRole,
      allNodeIds,
      layerNodeIds: activeNodeIds,
      activeNodeIds,
    },
  };
}

function createFallbackMachine(records, descriptor) {
  const paramOptions = records.map((record) => record.stateId);
  const states = records.map((record) => ({
    id: record.stateId,
    name: record.name,
    clipId: record.clipId,
    speed: 1,
    loop: true,
  }));

  return {
    id: normalizeId(descriptor.id, 'state-anim-machine'),
    name: descriptor.machineName || descriptor.label || 'State Anim Machine',
    params: [{
      id: 'param-state',
      name: 'state',
      type: 'enum',
      defaultValue: paramOptions[0] ?? '',
      enumOptions: paramOptions,
    }],
    layers: [{
      id: 'base-layer',
      name: 'Base Layer',
      layerRole: 'motion',
      priority: 0,
      defaultStateId: states[0]?.id ?? '',
      states,
      transitions: states.map((state, index) => ({
        id: `to-${state.id}`,
        fromStateId: 'any',
        toStateId: state.id,
        conditions: [{ paramName: 'state', operator: '==', value: state.id }],
        durationFrames: index === 0 ? 0 : 12,
        effect: DEFAULT_TRANSITION_EFFECT,
        exitTime: { enabled: false, normalized: 0 },
        onComplete: false,
        consumeConditions: false,
        priority: 10,
      })),
    }],
  };
}

function normalizeParam(rawParam, index) {
  const type = rawParam?.type === 'boolean' ? 'bool' : (rawParam?.type ?? 'enum');
  const enumOptions = rawParam?.enumOptions ?? rawParam?.options ?? [];
  const defaultValue = rawParam?.defaultValue ?? rawParam?.value ?? enumOptions[0] ?? (type === 'number' ? 0 : false);

  return {
    id: String(rawParam?.id ?? `param-${index}`),
    name: String(rawParam?.name ?? rawParam?.id ?? `param${index + 1}`),
    type,
    defaultValue,
    ...(type === 'enum' ? { enumOptions } : {}),
  };
}

function normalizeCondition(rawCondition) {
  const operator = rawCondition?.operator ?? (rawCondition?.equals === undefined ? '==' : '==');
  const value = rawCondition?.value ?? rawCondition?.equals ?? rawCondition?.is ?? true;

  return {
    paramName: String(rawCondition?.paramName ?? rawCondition?.param ?? rawCondition?.name ?? ''),
    operator,
    value,
  };
}

function normalizeTransition(rawTransition, index) {
  return {
    id: String(rawTransition?.id ?? `transition-${index}`),
    fromStateId: String(rawTransition?.fromStateId ?? rawTransition?.from ?? 'any'),
    toStateId: String(rawTransition?.toStateId ?? rawTransition?.to ?? ''),
    conditions: Array.isArray(rawTransition?.conditions)
      ? rawTransition.conditions.map(normalizeCondition).filter((condition) => condition.paramName)
      : [],
    durationFrames: Math.max(0, Math.round(toFiniteNumber(rawTransition?.durationFrames ?? rawTransition?.duration, 0))),
    effect: normalizeTransitionEffect(rawTransition?.effect),
    exitTime: normalizeTransitionExitTime(rawTransition?.exitTime),
    onComplete: rawTransition?.onComplete === true,
    consumeConditions: rawTransition?.consumeConditions === true,
    priority: Math.round(toFiniteNumber(rawTransition?.priority, 0)),
  };
}

function createClipResolver(records) {
  const lookup = new Map();

  records.forEach((record) => {
    [
      record.clipId,
      record.stateId,
      record.sourceClipId,
      record.compiledUrl,
      record.compiledStem,
      record.name,
      record.clipName,
      record.moodId,
    ].filter(Boolean).forEach((key) => {
      lookup.set(String(key), record.clipId);
    });
  });

  return (rawState) => {
    const candidates = [
      rawState?.clipId,
      rawState?.clipRef,
      rawState?.stateId,
      rawState?.id,
      rawState?.name,
    ].filter(Boolean).map(String);

    for (const candidate of candidates) {
      if (lookup.has(candidate)) {
        return lookup.get(candidate);
      }
    }

    return candidates[0] && lookup.get(normalizeId(candidates[0], candidates[0])) || records[0]?.clipId || '';
  };
}

function normalizeStateMachine(rawMachine, records, descriptor) {
  if (!rawMachine || rawMachine === true) {
    return createFallbackMachine(records, descriptor);
  }

  const machine = cloneJson(rawMachine);
  const resolveClipId = createClipResolver(records);
  const layers = Array.isArray(machine.layers) ? machine.layers : [];

  return {
    id: String(machine.id ?? normalizeId(descriptor.id, 'state-anim-machine')),
    name: String(machine.name ?? descriptor.machineName ?? descriptor.label ?? 'State Anim Machine'),
    params: Array.isArray(machine.params) ? machine.params.map(normalizeParam) : [],
    layers: layers.map((layer, layerIndex) => {
      const states = Array.isArray(layer.states)
        ? layer.states.map((state, stateIndex) => ({
          id: String(state.id ?? `state-${layerIndex}-${stateIndex}`),
          name: String(state.name ?? state.stateName ?? state.id ?? `State ${stateIndex + 1}`),
          clipId: resolveClipId(state),
          speed: toFiniteNumber(state.speed, 1),
          loop: state.loop !== false,
        }))
        : [];

      return {
        id: String(layer.id ?? `layer-${layerIndex}`),
        name: String(layer.name ?? `Layer ${layerIndex + 1}`),
        layerRole: layer.layerRole ?? layer.role ?? (layer.control ? 'control' : 'motion'),
        priority: Math.round(toFiniteNumber(layer.priority, layerIndex)),
        defaultStateId: String(layer.defaultStateId ?? layer.entryStateId ?? states[0]?.id ?? ''),
        states,
        transitions: Array.isArray(layer.transitions)
          ? layer.transitions.map(normalizeTransition).filter((transition) => transition.toStateId)
          : [],
        ...(layer.control ? { control: layer.control } : {}),
      };
    }),
    ...(machine.layout ? { layout: machine.layout } : {}),
    meta: {
      ...(machine.meta ?? {}),
      labDriver: true,
    },
  };
}

function appendUniqueChild(parent, childId) {
  if (!parent.children.includes(childId)) {
    parent.children.push(childId);
  }
}

function removeChild(parent, childId) {
  parent.children = parent.children.filter((candidate) => candidate !== childId);
}

function applyLayerHierarchy(nodes, artboardFrameId, layerDefs) {
  const artboard = nodes[artboardFrameId];

  if (!artboard) {
    return;
  }

  layerDefs.forEach((layerDef) => {
    const nodeId = getLayerNodeId(layerDef);
    const parentMotionKey = layerDef.parentMotionKey;
    const node = nodes[nodeId];
    const parent = parentMotionKey ? nodes[parentMotionKey] : null;

    if (!node || !parent || (parent.type !== 'group' && parent.type !== 'frame') || nodeId === parentMotionKey) {
      return;
    }

    node.parentId = parent.id;
    appendUniqueChild(parent, nodeId);
    removeChild(artboard, nodeId);
  });
}

async function loadPackageFromDescriptor(descriptor, source) {
  const resolved = await resolveStateAnimDescriptor(descriptor, source);
  descriptor = resolved.descriptor;
  source = resolved.source;

  if (!looksLikeStateAnimDescriptor(descriptor)) {
    throw new Error('当前 JSON 不是 state anim 描述文件：缺少 variants。');
  }

  const descriptorBase = source.type === 'url'
    ? dirname(source.url)
    : dirname(source.descriptorPath ?? '');
  const records = [];

  for (let index = 0; index < descriptor.variants.length; index += 1) {
    const variant = descriptor.variants[index];
    const compiledUrl = variant.compiledUrl ?? variant.motionUrl ?? variant.url;
    let motion = variant.motion ?? variant.compiled ?? null;

    if (!motion && compiledUrl) {
      if (source.type === 'zip') {
        const path = joinPath(descriptorBase, compiledUrl);
        const entry = source.entries.get(path) ?? source.entries.get(compiledUrl);

        if (!entry) {
          throw new Error(`Zip 中找不到 compiled motion: ${compiledUrl}`);
        }

        motion = entry.json();
      } else if (source.type === 'url') {
        motion = await fetchJson(joinUrl(descriptorBase, compiledUrl));
      } else {
        throw new Error(`本地 JSON 引用了 ${compiledUrl}，请导入包含资源的 zip，或通过 dev server 加载。`);
      }
    }

    const normalizedMotion = normalizeCompiledMotion(motion);
    const stateId = String(variant.stateId ?? variant.id ?? `state-${index}`);
    const compiledStem = compiledUrl ? compiledUrl.split('/').pop().replace(/\.state\.compiled\.json$|\.json$/g, '') : '';
    const clipId = normalizeId(variant.clipId ?? stateId, `clip-${index}`);

    records.push({
      clipId,
      stateId,
      sourceClipId: variant.clipId,
      moodId: variant.moodId,
      compiledUrl,
      compiledStem,
      name: String(variant.stateName ?? variant.clipName ?? variant.name ?? stateId),
      clipName: variant.clipName,
      templateId: descriptor.id,
      motion: normalizedMotion,
    });
  }

  const machine = normalizeStateMachine(descriptor.stateMachine, records, descriptor);

  machine.layers.forEach((layer) => {
    layer.states.forEach((state) => {
      const record = records.find((candidate) => candidate.clipId === state.clipId);

      if (!record) {
        return;
      }

      record.machineId = machine.id;
      record.machineLayerId = layer.id;
      record.machineLayerName = layer.name;
      record.layerRole = layer.layerRole;
    });
  });

  return buildRuntimePackage(descriptor, records, machine);
}

function buildRuntimePackage(descriptor, records, machine) {
  const firstMotion = records[0]?.motion ?? normalizeCompiledMotion({});
  const width = Math.max(1, toFiniteNumber(descriptor.boardBounds?.width, firstMotion.base.width));
  const height = Math.max(1, toFiniteNumber(descriptor.boardBounds?.height, firstMotion.base.height));
  const artboardFrameId = 'state-anim-artboard';
  const nodes = {
    [artboardFrameId]: createFrameNode(artboardFrameId, width, height, descriptor.boardLabel ?? descriptor.label ?? 'State Anim'),
  };
  const nodeIds = new Set();
  const allLayerDefs = new Map();
  const facePartsByNodeId = {};
  const positionOffsetsByNodeId = {};

  records.forEach((record) => {
    record.motion.layerDefs.forEach((layerDef) => {
      const nodeId = getLayerNodeId(layerDef);

      if (!nodeId || allLayerDefs.has(nodeId)) {
        return;
      }

      const rawLayerFaceParts = getLayerFaceParts(descriptor, record.motion, layerDef);
      const rawFirstPart = rawLayerFaceParts.find(Boolean) ?? {};
      const positionOffset = isContainerLayerDef(layerDef)
        ? { x: 0, y: 0 }
        : getPathPositionOffset(getLayerPathSource(record.motion, layerDef, rawFirstPart));
      const layerFaceParts = normalizeFacePartsWithOffset(rawLayerFaceParts, positionOffset);
      const firstPart = layerFaceParts.find(Boolean) ?? {};
      const channels = normalizeChannels(
        record.motion.layers?.[nodeId] ?? record.motion.layers?.[layerDef.id] ?? {},
        (value, property) => transformLayerValue(record.motion, layerDef, property, value, {
          ...positionOffsetsByNodeId,
          [nodeId]: positionOffset,
          [layerDef.motionKey]: positionOffset,
        }),
      );
      positionOffsetsByNodeId[nodeId] = positionOffset;
      positionOffsetsByNodeId[layerDef.motionKey] = positionOffset;
      facePartsByNodeId[nodeId] = layerFaceParts;

      if (isFrameLayerDef(layerDef)) {
        nodes[nodeId] = createLayerFrameNode(
          nodeId,
          layerDef.label ?? nodeId,
          artboardFrameId,
          layerDef,
          record.motion,
          getLayerDefSize(layerDef, record.motion, { width, height }),
          positionOffsetsByNodeId,
        );
      } else if (isGroupLayerDef(layerDef)) {
        nodes[nodeId] = createGroupNode(
          nodeId,
          layerDef.label ?? nodeId,
          artboardFrameId,
          layerDef,
          record.motion,
          getLayerDefSize(layerDef, record.motion, { width, height }),
          positionOffsetsByNodeId,
        );
      } else {
        nodes[nodeId] = createVectorNode(
          nodeId,
          layerDef.label ?? nodeId,
          artboardFrameId,
          channels,
          firstPart,
          { width, height },
          layerDef,
          record.motion,
          positionOffsetsByNodeId,
        );
      }
      nodes[artboardFrameId].children.push(nodeId);
      nodeIds.add(nodeId);
      allLayerDefs.set(nodeId, layerDef);
    });
  });

  applyLayerHierarchy(nodes, artboardFrameId, [...allLayerDefs.values()]);

  const allNodeIds = [...nodeIds];
  const clips = {};
  const clipOrder = [];

  records.forEach((record) => {
    clipOrder.push(record.clipId);
    clips[record.clipId] = createClipFromMotion(record, record.motion, allNodeIds, artboardFrameId, positionOffsetsByNodeId);
  });

  const document = {
    version: 1,
    artboard: {
      activeFrameId: artboardFrameId,
      frameIds: [artboardFrameId],
    },
    activeClipId: clipOrder[0] ?? '',
    clipOrder,
    clips,
    activeStateMachineId: machine.id,
    stateMachineOrder: [machine.id],
    stateMachines: {
      [machine.id]: machine,
    },
  };

  return {
    descriptor,
    records,
    document,
    nodes,
    machine,
    artboard: { width, height },
    layerDefs: [...allLayerDefs.values()],
    facePartsByNodeId,
    positionOffsetsByNodeId,
  };
}

async function loadPackageFromFile(file) {
  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith('.zip')) {
    const entries = readStoredZipEntries(await file.arrayBuffer());
    const descriptorPath = findDescriptorEntry(entries);

    if (!descriptorPath) {
      throw new Error('Zip 中没有找到 state anim 描述 JSON。');
    }

    return loadPackageFromDescriptor(entries.get(descriptorPath).json(), {
      type: 'zip',
      entries,
      descriptorPath,
    });
  }

  const descriptor = JSON.parse(await file.text());
  return loadPackageFromDescriptor(descriptor, { type: 'file' });
}

async function loadPackageFromUrl(url) {
  return loadPackageFromDescriptor(await fetchJson(url), { type: 'url', url });
}

class StateAnimSvgRenderer {
  constructor(svg) {
    this.svg = svg;
    this.layerViews = new Map();
    this.package = null;
  }

  mount(runtimePackage) {
    this.package = runtimePackage;
    this.layerViews.clear();
    this.svg.replaceChildren();
    this.svg.setAttribute(
      'viewBox',
      `${-runtimePackage.artboard.width / 2} ${-runtimePackage.artboard.height / 2} ${runtimePackage.artboard.width} ${runtimePackage.artboard.height}`,
    );

    const defs = createSvgElement('defs');
    const background = createSvgElement('rect');
    background.setAttribute('x', String(-runtimePackage.artboard.width / 2));
    background.setAttribute('y', String(-runtimePackage.artboard.height / 2));
    background.setAttribute('width', String(runtimePackage.artboard.width));
    background.setAttribute('height', String(runtimePackage.artboard.height));
    background.setAttribute('rx', '0');
    background.setAttribute('fill', runtimePackage.descriptor.frameTransparent ? 'transparent' : '#ffffff');
    this.svg.append(defs);
    this.svg.append(background);

    runtimePackage.layerDefs.forEach((layerDef, layerIndex) => {
      const nodeId = getLayerNodeId(layerDef);
      const node = runtimePackage.nodes[nodeId];
      const group = createSvgElement('g');
      const paths = [];
      let frameRect = null;
      let clipRect = null;
      const partIndexes = Array.isArray(layerDef.partIndexes) ? layerDef.partIndexes : [];
      const layerFaceParts = runtimePackage.facePartsByNodeId?.[nodeId] ?? [];

      group.dataset.nodeId = nodeId;

      if (node?.type === 'frame') {
        frameRect = createSvgElement('rect');
        frameRect.setAttribute('x', '0');
        frameRect.setAttribute('y', '0');
        frameRect.setAttribute('width', String(node.width));
        frameRect.setAttribute('height', String(node.height));
        frameRect.setAttribute('rx', String(node.radius ?? 0));
        frameRect.setAttribute('fill', 'none');
        frameRect.setAttribute('stroke', 'none');
        group.append(frameRect);

        if (node.clipContent) {
          const clipPath = createSvgElement('clipPath');
          const clipPathId = `clip-${layerIndex}-${nodeId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
          clipRect = createSvgElement('rect');

          clipPath.setAttribute('id', clipPathId);
          clipPath.setAttribute('clipPathUnits', 'userSpaceOnUse');
          clipRect.setAttribute('x', '0');
          clipRect.setAttribute('y', '0');
          clipRect.setAttribute('width', String(node.width));
          clipRect.setAttribute('height', String(node.height));
          clipRect.setAttribute('rx', String(node.radius ?? 0));
          clipPath.append(clipRect);
          defs.append(clipPath);
          group.setAttribute('clip-path', `url(#${clipPathId})`);
        }
      }

      partIndexes.forEach((partIndex, index) => {
        const part = layerFaceParts[index] ?? runtimePackage.descriptor.faceParts?.[partIndex];

        if (!part?.d) {
          return;
        }

        const path = createSvgElement('path');
        path.setAttribute('d', part.d);
        path.dataset.baseD = part.d;
        path.dataset.baseFill = normalizeHexColor(part.fill, '#000000');
        path.dataset.baseStroke = part.stroke ? normalizeHexColor(part.stroke, '#000000') : 'none';
        path.dataset.baseStrokeWidth = String(toFiniteNumber(part.strokeWidth, 0));
        group.append(path);
        paths.push(path);
      });

      this.layerViews.set(nodeId, {
        group,
        paths,
        frameRect,
        clipRect,
        bbox: this.resolveBBox(group),
      });
    });

    const appendNodeView = (nodeId, parentElement) => {
      const node = runtimePackage.nodes[nodeId];
      const view = this.layerViews.get(nodeId);

      if (!node) {
        return;
      }

      if (view) {
        parentElement.append(view.group);
      }

      const childParentElement = view?.group ?? parentElement;
      (node.children ?? []).forEach((childId) => appendNodeView(childId, childParentElement));
    };

    (runtimePackage.nodes[runtimePackage.document.artboard.activeFrameId]?.children ?? [])
      .forEach((nodeId) => appendNodeView(nodeId, this.svg));
  }

  resolveBBox(group) {
    try {
      const box = group.getBBox();

      if (Number.isFinite(box.width) && Number.isFinite(box.height) && (box.width > 0 || box.height > 0)) {
        return box;
      }
    } catch {
      // getBBox can fail before the SVG is fully attached.
    }

    return { x: 0, y: 0, width: 0, height: 0 };
  }

  render(evaluated) {
    if (!this.package || !evaluated) {
      return;
    }

    this.package.layerDefs.forEach((layerDef) => {
      const nodeId = getLayerNodeId(layerDef);
      const node = this.package.nodes[nodeId];
      const view = this.layerViews.get(nodeId);

      if (!node || !view) {
        return;
      }

      const override = evaluated.nodeOverrides[nodeId] ?? {};
      const x = toFiniteNumber(override.x, node.x);
      const y = toFiniteNumber(override.y, node.y);
      const rotation = toFiniteNumber(override.rotation, node.rotation);
      const scaleX = toFiniteNumber(override.scaleX, 1);
      const scaleY = toFiniteNumber(override.scaleY, 1);
      const opacity = clamp(toFiniteNumber(override.opacity, node.opacity), 0, 1);
      const bbox = view.bbox.width || view.bbox.height ? view.bbox : this.resolveBBox(view.group);
      const pivotX = bbox.x + bbox.width / 2;
      const pivotY = bbox.y + bbox.height / 2;

      view.bbox = bbox;
      view.group.setAttribute(
        'transform',
        `translate(${x + pivotX} ${y + pivotY}) rotate(${rotation}) scale(${scaleX} ${scaleY}) translate(${-pivotX} ${-pivotY})`,
      );
      view.group.setAttribute('opacity', String(opacity));

      if (view.frameRect) {
        const fill = override.fill ?? node.fill ?? '#FFFFFF';
        const stroke = override.stroke ?? node.stroke ?? 'none';
        const strokeWidth = toFiniteNumber(node.strokeWidth, 0);
        const fillOpacity = clamp(toFiniteNumber(node.fillOpacity, 1), 0, 1);
        const strokeOpacity = clamp(toFiniteNumber(node.strokeOpacity, 1), 0, 1);
        const radius = toFiniteNumber(node.radius, 0);

        view.frameRect.setAttribute('width', String(node.width));
        view.frameRect.setAttribute('height', String(node.height));
        view.frameRect.setAttribute('rx', String(radius));
        view.frameRect.setAttribute('fill', node.fillVisible && fillOpacity > 0 && fill !== 'none' ? fill : 'none');
        view.frameRect.setAttribute('fill-opacity', String(fillOpacity));
        view.frameRect.setAttribute('stroke', node.strokeVisible && stroke && stroke !== 'none' && strokeWidth > 0 ? stroke : 'none');
        view.frameRect.setAttribute('stroke-width', String(strokeWidth));
        view.frameRect.setAttribute('stroke-opacity', String(strokeOpacity));

        if (view.clipRect) {
          view.clipRect.setAttribute('width', String(node.width));
          view.clipRect.setAttribute('height', String(node.height));
          view.clipRect.setAttribute('rx', String(radius));
        }
      }

      const layerFaceParts = this.package.facePartsByNodeId?.[nodeId] ?? [];

      view.paths.forEach((path, index) => {
        const partIndex = layerDef.partIndexes?.[index];
        const part = layerFaceParts[index] ?? this.package.descriptor.faceParts?.[partIndex] ?? {};
        const fill = override.fill ?? part.fill ?? path.dataset.baseFill ?? '#000000';
        const stroke = override.stroke ?? part.stroke ?? path.dataset.baseStroke ?? 'none';
        const strokeWidth = toFiniteNumber(part.strokeWidth ?? path.dataset.baseStrokeWidth, 0);

        path.setAttribute('fill', fill && fill !== 'none' ? fill : 'none');
        path.setAttribute('stroke', stroke && stroke !== 'none' && strokeWidth > 0 ? stroke : 'none');
        path.setAttribute('stroke-width', String(strokeWidth));

        if (override.path?.pathData && index === 0) {
          path.setAttribute('d', override.path.pathData);
        } else if (typeof override.path === 'string' && index === 0) {
          path.setAttribute('d', override.path);
        } else {
          path.setAttribute('d', path.dataset.baseD ?? part.d ?? '');
        }
      });
    });
  }
}

class StateAnimDriveApp {
  constructor() {
    this.renderer = new StateAnimSvgRenderer(elements.avatarStage);
    this.package = null;
    this.runtime = null;
    this.paramValues = {};
    this.evaluated = null;
    this.playing = false;
    this.lastTickTime = 0;
    this.lastDebugRenderTime = 0;
    this.speed = 1;
    this.frame = 0;

    this.bindEvents();
    this.renderEmptyState();
  }

  bindEvents() {
    elements.fileInput.addEventListener('change', async (event) => {
      const [file] = event.target.files ?? [];

      if (!file) {
        return;
      }

      try {
        await this.load(await loadPackageFromFile(file), file.name);
      } catch (error) {
        this.handleError(error);
      } finally {
        event.target.value = '';
      }
    });

    elements.playToggleBtn.addEventListener('click', () => this.togglePlay());
    elements.stepBtn.addEventListener('click', () => this.advance(1));
    elements.resetBtn.addEventListener('click', () => this.reset());
    elements.interruptBtn.addEventListener('click', () => this.triggerFirstInterrupt());
    elements.speedInput.addEventListener('input', () => {
      this.speed = toFiniteNumber(elements.speedInput.value, 1);
      elements.speedOutput.textContent = `${this.speed.toFixed(1)}x`;
    });
  }

  async load(runtimePackage, sourceName) {
    this.stop();
    this.package = runtimePackage;
    this.runtime = createStateMachineRuntime(runtimePackage.machine);
    this.paramValues = createParamValues(runtimePackage.machine);
    this.evaluated = null;
    this.frame = 0;
    this.lastDebugRenderTime = 0;
    this.renderer.mount(runtimePackage);
    this.enableControls(true);
    this.renderParamControls();
    this.advance(0);
    writeLog(`已加载 ${sourceName}: ${runtimePackage.records.length} clips, ${runtimePackage.layerDefs.length} layers`);
  }

  enableControls(enabled) {
    elements.playToggleBtn.disabled = !enabled;
    elements.stepBtn.disabled = !enabled;
    elements.resetBtn.disabled = !enabled;
    elements.interruptBtn.disabled = !enabled;
  }

  renderEmptyState() {
    this.enableControls(false);
    elements.paramPanel.innerHTML = '<p class="muted">加载后展示状态机参数控件。</p>';
    elements.layerStatePanel.innerHTML = '<p class="muted">加载后显示各 Layer 当前状态。</p>';
    setStageStatus('未加载');
  }

  reset() {
    if (!this.package) {
      return;
    }

    this.stop();
    this.runtime = createStateMachineRuntime(this.package.machine);
    this.paramValues = createParamValues(this.package.machine, this.paramValues);
    this.frame = 0;
    this.lastDebugRenderTime = 0;
    this.advance(0);
  }

  togglePlay() {
    if (this.playing) {
      this.stop();
      return;
    }

    this.play();
  }

  play() {
    if (this.playing) {
      return;
    }

    this.playing = true;
    elements.playToggleBtn.textContent = 'Pause';
    this.lastTickTime = performance.now();
    requestAnimationFrame((time) => this.tick(time));
  }

  stop() {
    this.playing = false;
    elements.playToggleBtn.textContent = 'Play';
  }

  tick(time) {
    if (!this.playing || !this.package) {
      return;
    }

    const fps = this.resolveFps();
    const deltaFrames = ((time - this.lastTickTime) / 1000) * fps * this.speed;
    this.lastTickTime = time;
    this.advance(deltaFrames);
    requestAnimationFrame((nextTime) => this.tick(nextTime));
  }

  resolveFps() {
    if (!this.package) {
      return 30;
    }

    const activeClip = this.package.document.clips[this.package.document.activeClipId];
    return activeClip?.timeline.fps ?? this.package.records[0]?.motion.fps ?? 30;
  }

  advance(deltaFrames) {
    if (!this.package) {
      return;
    }

    const machineId = this.package.machine.id;
    const result = advanceStateMachine(
      this.package.document,
      machineId,
      this.runtime,
      this.paramValues,
      this.package.nodes,
      deltaFrames,
      { visibilityIsolation: 'opacity' },
    );

    this.runtime = result.runtime;
    this.paramValues = result.paramValues;
    this.evaluated = result.evaluated;
    this.frame = this.evaluated?.frame ?? this.frame + deltaFrames;
    this.renderer.render(this.evaluated);
    this.renderDebugPanels();
  }

  renderDebugPanels() {
    const now = performance.now();

    if (this.playing && now - this.lastDebugRenderTime < DEBUG_PANEL_UPDATE_INTERVAL_MS) {
      return;
    }

    this.lastDebugRenderTime = now;
    this.renderRuntime();
    this.renderLayerStatePanel();
    this.syncParamControlValues();
  }

  renderParamControls() {
    if (!this.package) {
      return;
    }

    elements.paramPanel.replaceChildren();

    if (this.package.machine.params.length === 0) {
      elements.paramPanel.innerHTML = '<p class="muted">当前状态机没有参数。</p>';
      return;
    }

    this.package.machine.params.forEach((param) => {
      const row = createElement('div', 'param-row');
      const label = createElement('label');
      label.textContent = `${param.name} (${param.type})`;
      row.append(label);

      if (param.type === 'enum') {
        const select = createElement('select');
        select.dataset.paramName = param.name;
        (param.enumOptions ?? []).forEach((option) => {
          const optionElement = createElement('option');
          optionElement.value = option;
          optionElement.textContent = option;
          select.append(optionElement);
        });
        select.value = String(this.paramValues[param.name] ?? param.defaultValue ?? '');
        select.addEventListener('change', () => this.setParam(param.name, select.value));
        row.append(select);
      } else if (param.type === 'number') {
        const inline = createElement('div', 'param-inline');
        const input = createElement('input');
        input.type = 'number';
        input.step = '0.1';
        input.dataset.paramName = param.name;
        input.value = String(this.paramValues[param.name] ?? param.defaultValue ?? 0);
        input.addEventListener('change', () => this.setParam(param.name, toFiniteNumber(input.value, 0)));
        inline.append(input);
        row.append(inline);
      } else if (param.type === 'trigger') {
        const button = createElement('button');
        button.type = 'button';
        button.textContent = 'Trigger';
        button.addEventListener('click', () => this.setParam(param.name, true));
        row.append(button);
      } else {
        const inline = createElement('div', 'param-inline');
        const input = createElement('input');
        input.type = 'checkbox';
        input.dataset.paramName = param.name;
        input.checked = this.paramValues[param.name] === true;
        input.addEventListener('change', () => this.setParam(param.name, input.checked));
        inline.append(input);
        row.append(inline);
      }

      elements.paramPanel.append(row);
    });
  }

  syncParamControlValues() {
    elements.paramPanel.querySelectorAll('[data-param-name]').forEach((control) => {
      const paramName = control.dataset.paramName;

      if (!paramName || !(paramName in this.paramValues)) {
        return;
      }

      if (control.type === 'checkbox') {
        control.checked = this.paramValues[paramName] === true;
      } else {
        control.value = String(this.paramValues[paramName]);
      }
    });
  }

  setParam(name, value) {
    this.paramValues = {
      ...this.paramValues,
      [name]: value,
    };
    this.lastDebugRenderTime = 0;
    this.advance(0);
    this.play();
  }

  triggerFirstInterrupt() {
    const triggerParam = this.package?.machine.params.find((param) =>
      param.type === 'trigger' || /interrupt/i.test(param.name));

    if (!triggerParam) {
      writeLog('当前状态机没有 trigger / interrupt 参数。');
      return;
    }

    this.setParam(triggerParam.name, true);
  }

  renderLayerStatePanel() {
    if (!this.package || !this.runtime) {
      return;
    }

    elements.layerStatePanel.replaceChildren();

    this.package.machine.layers.forEach((layer) => {
      const row = createElement('div', 'layer-state-row');
      const title = createElement('label');
      const runtime = this.runtime.layers[layer.id];
      const currentState = layer.states.find((state) => state.id === runtime?.currentStateId);
      const transition = runtime?.transition;
      title.textContent = layer.name;
      row.append(title);

      const meta = createElement('div', 'layer-state-meta');
      if (transition) {
        const toState = layer.states.find((state) => state.id === transition.toStateId);
        const progress = transition.durationFrames > 0
          ? Math.round(clamp(transition.elapsedFrames / transition.durationFrames, 0, 1) * 100)
          : 100;
        meta.textContent = `${currentState?.name ?? runtime?.currentStateId ?? '-'} -> ${toState?.name ?? transition.toStateId} · ${progress}%`;
      } else {
        meta.textContent = `${currentState?.name ?? runtime?.currentStateId ?? '-'} · frame ${Math.round(runtime?.stateFrame ?? 0)}`;
      }
      row.append(meta);
      elements.layerStatePanel.append(row);
    });
  }

  renderRuntime() {
    const unsupported = this.evaluated?.unsupported ?? [];
    const controlReports = this.evaluated?.stateMachineControlProjections ?? [];
    const payload = {
      source: this.evaluated?.source ?? 'none',
      frame: Number((this.evaluated?.frame ?? 0).toFixed(2)),
      params: this.paramValues,
      runtime: this.runtime,
      controlReports,
      unsupported,
    };

    elements.runtimeBox.textContent = JSON.stringify(payload, null, 2);
    setStageStatus(`${this.package?.machine.name ?? 'State Anim'} · frame ${payload.frame}`);
  }

  handleError(error) {
    console.error(error);
    writeLog(error instanceof Error ? error.message : String(error));
    setStageStatus('加载失败');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new StateAnimDriveApp();
  window.stateAnimDrive = app;

  const debugEvaluateButton = document.querySelector('#debugEvaluateClipBtn');
  debugEvaluateButton?.addEventListener('click', () => {
    const runtimePackage = app.package;

    if (!runtimePackage) {
      return;
    }

    const clipId = runtimePackage.document.activeClipId;
    const evaluated = evaluateClipAtFrame(runtimePackage.document, clipId, 0, runtimePackage.nodes, {
      visibilityIsolation: 'opacity',
    });
    console.info('[state-anim-drive] clip frame 0', evaluated);
  });
});
