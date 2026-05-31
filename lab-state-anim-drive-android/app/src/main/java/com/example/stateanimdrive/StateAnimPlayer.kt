package com.example.stateanimdrive

class StateAnimPlayer(private val runtimePackage: StateAnimPackage) {
    private val params = linkedMapOf<String, Any>()
    private val layerRuntimes = linkedMapOf<String, LayerRuntime>()

    init {
        reset()
    }

    fun reset() {
        params.clear()
        runtimePackage.machine.params.forEach { param ->
            params[param.name] = normalizeParamValue(param, param.defaultValue)
        }
        layerRuntimes.clear()
        runtimePackage.machine.layers.forEach { layer ->
            val defaultState = layer.states.firstOrNull { it.id == layer.defaultStateId }
                ?: layer.states.firstOrNull()
            if (defaultState != null) {
                layerRuntimes[layer.id] = LayerRuntime(defaultState.id, 0f, null)
            }
        }
    }

    fun getParam(name: String): Any? = params[name]

    fun setParam(name: String, value: Any) {
        val param = runtimePackage.machine.params.firstOrNull { it.name == name }
        params[name] = if (param != null) normalizeParamValue(param, value) else value
    }

    fun triggerInterrupt() {
        val trigger = runtimePackage.machine.params.firstOrNull {
            it.type == "trigger" || it.name.contains("interrupt", ignoreCase = true)
        }
        if (trigger != null) {
            params[trigger.name] = true
        }
    }

    fun activeFps(): Int {
        val motionLayer = runtimePackage.machine.layers.firstOrNull { it.role != "control" }
        val state = motionLayer?.let { layer ->
            layerRuntimes[layer.id]?.currentStateId?.let { id -> layer.states.firstOrNull { it.id == id } }
        }
        return state?.clipId?.let { runtimePackage.clips[it]?.fps } ?: runtimePackage.clips.values.firstOrNull()?.fps ?: 30
    }

    fun advance(deltaFrames: Float) {
        val safeDelta = deltaFrames.coerceAtLeast(0f)

        runtimePackage.machine.layers.forEach { layer ->
            val runtime = layerRuntimes[layer.id] ?: return@forEach
            val currentState = layer.states.firstOrNull { it.id == runtime.currentStateId }
                ?: layer.states.firstOrNull()
                ?: return@forEach
            val activeTransition = runtime.transition

            if (activeTransition != null) {
                val duration = activeTransition.durationFrames.coerceAtLeast(0)
                if (duration <= 0) {
                    runtime.currentStateId = activeTransition.toStateId
                    runtime.frame = 0f
                    runtime.transition = null
                    return@forEach
                }

                val remainingFrames = (duration - activeTransition.elapsedFrames).coerceAtLeast(0f)
                val consumedFrames = safeDelta.coerceAtMost(remainingFrames)
                activeTransition.elapsedFrames += consumedFrames
                if (activeTransition.elapsedFrames >= duration) {
                    val targetState = layer.states.firstOrNull { it.id == activeTransition.toStateId }
                    runtime.currentStateId = activeTransition.toStateId
                    runtime.frame = targetState?.let {
                        resolveCompletedTransitionTargetFrame(it, activeTransition, safeDelta - consumedFrames)
                    } ?: 0f
                    runtime.transition = null
                }
                return@forEach
            }

            val selected = selectTransition(layer, currentState, runtime.frame)
            if (selected != null) {
                consumeTransitionConditions(layer, selected)

                if (selected.durationFrames <= 0) {
                    val targetState = layer.states.firstOrNull { it.id == selected.toStateId }
                    runtime.currentStateId = selected.toStateId
                    runtime.frame = targetState?.let { advanceStateFrame(it, 0f, safeDelta) } ?: 0f
                    runtime.transition = null
                    return@forEach
                }

                runtime.transition = ActiveTransition(
                    fromStateId = currentState.id,
                    toStateId = selected.toStateId,
                    fromFrame = runtime.frame,
                    toFrame = 0f,
                    elapsedFrames = 0f,
                    durationFrames = selected.durationFrames,
                    effectMode = selected.effectMode,
                    targetFramePolicy = selected.targetFramePolicy
                )
                return@forEach
            }

            runtime.frame = advanceStateFrame(currentState, runtime.frame, safeDelta)
        }
    }

    fun snapshot(): RenderSnapshot {
        val controlOverrides = buildControlOverrides()
        val motionLayer = runtimePackage.machine.layers
            .filter { it.role != "control" }
            .maxByOrNull { it.priority }
        val passes = motionLayer?.let(::renderPasses).orEmpty()
        val status = motionLayer?.let { layer ->
            val runtime = layerRuntimes[layer.id]
            val state = layer.states.firstOrNull { it.id == runtime?.currentStateId }
            val transition = runtime?.transition
            if (transition != null) {
                val target = layer.states.firstOrNull { it.id == transition.toStateId }
                "${state?.name.orEmpty()} -> ${target?.name.orEmpty()} ${(transition.progress() * 100f).toInt()}%"
            } else {
                "${state?.name.orEmpty()} · frame ${runtime?.frame?.toInt() ?: 0}"
            }
        } ?: "No motion layer"

        return RenderSnapshot(passes, controlOverrides, status)
    }

    private fun buildControlOverrides(): Map<String, ProjectedLayerOverride> {
        val result = linkedMapOf<String, ProjectedLayerOverride>()
        val controlLayers = runtimePackage.machine.layers
            .filter { it.role == "control" || it.control != null }
            .sortedWith(compareBy<MachineLayer> { it.control?.priority ?: it.priority }.thenBy { it.priority })

        controlLayers.forEach { layer ->
            val config = layer.control ?: return@forEach
            val projectedByMatchKey = evaluateControlLayerByMatchKey(layer, config)
            val priority = config.priority

            projectedByMatchKey.forEach { (matchKey, projected) ->
                val target = result.getOrPut(matchKey) { ProjectedLayerOverride() }
                target.mergeFrom(projected, priority)
            }
        }

        return result
    }

    private fun evaluateControlLayerByMatchKey(
        layer: MachineLayer,
        config: ControlConfig
    ): Map<String, LayerOverride> {
        val projectedProperties = config.properties.takeIf { it.isNotEmpty() }
        val weightedByMatchKey = linkedMapOf<String, WeightedOverride>()

        layerSamples(layer).forEach { sample ->
            sample.clip.renderLayers.forEach { renderLayer ->
                val override = evaluateLayer(renderLayer, sample.frame)
                val projected = LayerOverride()
                projected.mergeFrom(override, projectedProperties)

                if (hasAnyProjectedValue(projected)) {
                    weightedByMatchKey
                        .getOrPut(renderLayer.matchKey) { WeightedOverride() }
                        .add(projected, sample.alpha)
                }
            }
        }

        return weightedByMatchKey.mapValues { it.value.toOverride() }
    }

    private fun hasAnyProjectedValue(override: LayerOverride): Boolean =
        override.x != null || override.y != null ||
            override.scaleX != null || override.scaleY != null ||
            override.rotation != null || override.opacity != null ||
            override.fill != null || override.stroke != null || override.pathData != null

    private fun layerSamples(layer: MachineLayer): List<ClipSample> {
        val runtime = layerRuntimes[layer.id] ?: return emptyList()
        val transition = runtime.transition

        if (transition != null) {
            val fromState = layer.states.firstOrNull { it.id == transition.fromStateId }
            val toState = layer.states.firstOrNull { it.id == transition.toStateId }
            val fromClip = fromState?.clipId?.let { runtimePackage.clips[it] }
            val toClip = toState?.clipId?.let { runtimePackage.clips[it] }
            val progress = transition.blendProgress()
            val samples = mutableListOf<ClipSample>()

            if (fromClip != null && progress < 1f) {
                samples += ClipSample(fromClip, transition.fromFrame, 1f - progress)
            }
            if (toClip != null && progress > 0f) {
                samples += ClipSample(toClip, transition.targetFrame(), progress)
            }
            return samples
        }

        val state = layer.states.firstOrNull { it.id == runtime.currentStateId } ?: return emptyList()
        val clip = runtimePackage.clips[state.clipId] ?: return emptyList()
        return listOf(ClipSample(clip, runtime.frame, 1f))
    }

    private fun renderPasses(layer: MachineLayer): List<RenderPass> {
        val runtime = layerRuntimes[layer.id] ?: return emptyList()
        val transition = runtime.transition

        if (transition == null) {
            val state = layer.states.firstOrNull { it.id == runtime.currentStateId } ?: return emptyList()
            val clip = runtimePackage.clips[state.clipId] ?: return emptyList()
            return listOf(RenderPass(clip = clip, frame = runtime.frame, alpha = 1f, priority = layer.priority))
        }

        val fromState = layer.states.firstOrNull { it.id == transition.fromStateId }
        val toState = layer.states.firstOrNull { it.id == transition.toStateId }
        val fromClip = fromState?.clipId?.let { runtimePackage.clips[it] }
        val toClip = toState?.clipId?.let { runtimePackage.clips[it] }
        val progress = transition.blendProgress()
        val toFrame = transition.targetFrame()

        if (fromClip == null && toClip == null) return emptyList()
        if (fromClip == null || progress >= 1f) {
            return toClip?.let { listOf(RenderPass(clip = it, frame = toFrame, alpha = 1f, priority = layer.priority)) }.orEmpty()
        }
        if (toClip == null || progress <= 0f) {
            return listOf(RenderPass(clip = fromClip, frame = transition.fromFrame, alpha = 1f, priority = layer.priority))
        }

        val fromLayerOverrides = evaluateClipLayerOverrides(fromClip, transition.fromFrame)
        val toLayerOverrides = evaluateClipLayerOverrides(toClip, toFrame)
        val fromByMatchKey = fromClip.renderLayers
            .groupBy { it.matchKey }
            .mapValues { (_, layers) -> ArrayDeque(layers) }
        val matchedFromKeys = mutableSetOf<String>()
        val toPassOverrides = linkedMapOf<String, LayerOverride>()

        toClip.renderLayers.forEach { toLayer ->
            val fromLayer = fromByMatchKey[toLayer.matchKey]?.removeFirstOrNull()

            if (fromLayer != null) {
                matchedFromKeys += fromLayer.key
                toPassOverrides[toLayer.key] = blendLayerOverrides(
                    fromLayer = fromLayer,
                    fromExplicit = fromLayerOverrides[fromLayer.key],
                    toLayer = toLayer,
                    toExplicit = toLayerOverrides[toLayer.key],
                    progress = progress
                )
            } else {
                val explicit = toLayerOverrides[toLayer.key] ?: LayerOverride()
                val opacity = explicit.opacity ?: toLayer.baseOpacity
                toPassOverrides[toLayer.key] = explicit.copy(opacity = opacity * progress)
            }
        }

        val fromOnlyKeys = fromClip.renderLayers
            .map { it.key }
            .filterNot { matchedFromKeys.contains(it) }
            .toSet()
        val fromOnlyOverrides = fromOnlyKeys.associateWith { key ->
            val renderLayer = fromClip.renderLayerByKey.getValue(key)
            val explicit = fromLayerOverrides[key] ?: LayerOverride()
            val opacity = explicit.opacity ?: renderLayer.baseOpacity
            explicit.copy(opacity = opacity * (1f - progress))
        }

        return buildList {
            if (fromOnlyKeys.isNotEmpty()) {
                add(
                    RenderPass(
                        clip = fromClip,
                        frame = transition.fromFrame,
                        alpha = 1f,
                        priority = layer.priority,
                        layerOverrides = fromOnlyOverrides,
                        includedLayerKeys = fromOnlyKeys
                    )
                )
            }

            add(
                RenderPass(
                    clip = toClip,
                    frame = toFrame,
                    alpha = 1f,
                    priority = layer.priority,
                    layerOverrides = toPassOverrides
                )
            )
        }
    }

    private fun evaluateClipLayerOverrides(clip: MotionClip, frame: Float): Map<String, LayerOverride> =
        clip.renderLayers.associate { layer -> layer.key to evaluateLayer(layer, frame) }

    private fun resolveLayerOverride(layer: RenderLayer, override: LayerOverride?): LayerOverride =
        LayerOverride(
            x = override?.x ?: layer.baseX,
            y = override?.y ?: layer.baseY,
            scaleX = override?.scaleX ?: layer.baseScaleX,
            scaleY = override?.scaleY ?: layer.baseScaleY,
            rotation = override?.rotation ?: layer.baseRotation,
            opacity = override?.opacity ?: layer.baseOpacity,
            fill = override?.fill ?: layer.baseFill ?: layer.faceParts.firstOrNull()?.fill,
            stroke = override?.stroke ?: layer.baseStroke ?: layer.faceParts.firstOrNull()?.stroke,
            pathData = override?.pathData ?: layer.faceParts.firstOrNull()?.pathData
        )

    private fun blendLayerOverrides(
        fromLayer: RenderLayer,
        fromExplicit: LayerOverride?,
        toLayer: RenderLayer,
        toExplicit: LayerOverride?,
        progress: Float
    ): LayerOverride {
        val fromResolved = resolveLayerOverride(fromLayer, fromExplicit)
        val toResolved = resolveLayerOverride(toLayer, toExplicit)
        val hasExplicitFill = fromExplicit?.fill != null || toExplicit?.fill != null
        val hasExplicitStroke = fromExplicit?.stroke != null || toExplicit?.stroke != null

        return LayerOverride(
            x = blendNumber(fromResolved.x, toResolved.x, progress),
            y = blendNumber(fromResolved.y, toResolved.y, progress),
            scaleX = blendNumber(fromResolved.scaleX, toResolved.scaleX, progress),
            scaleY = blendNumber(fromResolved.scaleY, toResolved.scaleY, progress),
            rotation = blendNumber(fromResolved.rotation, toResolved.rotation, progress),
            opacity = blendNumber(fromResolved.opacity, toResolved.opacity, progress),
            fill = if (hasExplicitFill) blendColor(fromResolved.fill, toResolved.fill, progress) else null,
            stroke = if (hasExplicitStroke) blendColor(fromResolved.stroke, toResolved.stroke, progress) else null,
            pathData = blendPath(fromResolved.pathData, toResolved.pathData, progress)
        )
    }

    private fun selectTransition(
        layer: MachineLayer,
        currentState: MachineState,
        currentFrame: Float
    ): MachineTransition? {
        return layer.transitions
            .filter { transition ->
                (transition.fromStateId == "any" || transition.fromStateId == currentState.id) &&
                    transition.toStateId != currentState.id &&
                    layer.states.any { it.id == transition.toStateId } &&
                    transition.conditions.all(::conditionMatches) &&
                    (!transition.onComplete || hasStateCompleted(currentState, currentFrame))
            }
            .maxWithOrNull(compareBy<MachineTransition> { it.priority })
    }

    private fun consumeTransitionConditions(layer: MachineLayer, transition: MachineTransition) {
        val paramsByName = runtimePackage.machine.params.associateBy { it.name }
        val targetState = layer.states.firstOrNull { it.id == transition.toStateId }
        val targetHasCompletionTransition = targetState != null && layer.transitions.any {
            it.fromStateId == targetState.id && it.onComplete && it.toStateId != targetState.id
        }

        transition.conditions.forEach { condition ->
            val param = paramsByName[condition.paramName] ?: return@forEach
            when {
                param.type == "trigger" -> params[param.name] = false
                transition.consumeConditions -> params[param.name] = normalizeParamValue(param, param.defaultValue)
                param.type == "enum" && targetState?.loop == false && targetHasCompletionTransition ->
                    params[param.name] = normalizeParamValue(param, param.defaultValue)
            }
        }
    }

    private fun conditionMatches(condition: TransitionCondition): Boolean {
        val left = params[condition.paramName]
        val right = condition.value

        return when (condition.operator) {
            "==" -> valuesEqual(left, right)
            ">" -> left.asFloat(Float.NaN) > right.asFloat(Float.NaN)
            ">=" -> left.asFloat(Float.NaN) >= right.asFloat(Float.NaN)
            "<" -> left.asFloat(Float.NaN) < right.asFloat(Float.NaN)
            "<=" -> left.asFloat(Float.NaN) <= right.asFloat(Float.NaN)
            else -> valuesEqual(left, right)
        }
    }

    private fun valuesEqual(left: Any?, right: Any?): Boolean {
        if (left is Boolean || right is Boolean) return left == right
        return left?.toString() == right?.toString()
    }

    private fun hasStateCompleted(state: MachineState, frame: Float): Boolean {
        val duration = runtimePackage.clips[state.clipId]?.frames ?: 0
        if (duration <= 0) return true
        val completion = if (state.loop) (duration - 1).coerceAtLeast(0) else duration
        return frame >= completion
    }

    private fun advanceStateFrame(state: MachineState, currentFrame: Float, deltaFrames: Float): Float {
        val duration = runtimePackage.clips[state.clipId]?.frames ?: 0
        if (duration <= 0) return 0f

        val rawFrame = (currentFrame + deltaFrames * state.speed.coerceAtLeast(0.01f)).coerceAtLeast(0f)
        return if (state.loop) rawFrame % duration else rawFrame.coerceAtMost(duration.toFloat())
    }

    private fun resolveCompletedTransitionTargetFrame(
        targetState: MachineState,
        transition: ActiveTransition,
        leftoverFrames: Float
    ): Float {
        val targetBaseFrame = transition.targetFrame()
        return advanceStateFrame(targetState, targetBaseFrame, leftoverFrames.coerceAtLeast(0f))
    }

    private fun normalizeParamValue(param: MachineParam, value: Any): Any {
        return when (param.type) {
            "number" -> value.asFloat()
            "bool", "trigger" -> value == true || value.toString() == "true"
            "enum" -> value.toString().takeIf { param.enumOptions.contains(it) }
                ?: param.enumOptions.firstOrNull()
                ?: value.toString()
            else -> value
        }
    }

    private data class LayerRuntime(
        var currentStateId: String,
        var frame: Float,
        var transition: ActiveTransition?
    )

    private data class ActiveTransition(
        val fromStateId: String,
        val toStateId: String,
        val fromFrame: Float,
        val toFrame: Float,
        var elapsedFrames: Float,
        val durationFrames: Int,
        val effectMode: String,
        val targetFramePolicy: String
    ) {
        fun progress(): Float =
            if (durationFrames <= 0) 1f else clamp(elapsedFrames / durationFrames.toFloat(), 0f, 1f)

        fun blendProgress(): Float {
            val progress = progress()
            return if (effectMode == "cut" && progress < 1f) 0f else progress
        }

        fun targetFrame(): Float =
            if (targetFramePolicy == "current-frame") toFrame + elapsedFrames else toFrame
    }

    private class WeightedOverride {
        private var totalWeight = 0f
        private var value = LayerOverride()

        fun add(next: LayerOverride, weight: Float) {
            val safeWeight = weight.coerceAtLeast(0f)
            if (safeWeight <= 0f) return

            val nextTotal = totalWeight + safeWeight
            val nextRatio = if (nextTotal <= 0f) 1f else safeWeight / nextTotal
            value = blendOverrides(value, next, nextRatio)
            totalWeight = nextTotal
        }

        fun toOverride(): LayerOverride = value
    }

    companion object {
        private fun blendOverrides(from: LayerOverride, to: LayerOverride, progress: Float): LayerOverride {
            val t = clamp(progress, 0f, 1f)

            return LayerOverride(
                x = blendNumber(from.x, to.x, t),
                y = blendNumber(from.y, to.y, t),
                scaleX = blendNumber(from.scaleX, to.scaleX, t),
                scaleY = blendNumber(from.scaleY, to.scaleY, t),
                rotation = blendNumber(from.rotation, to.rotation, t),
                opacity = blendNumber(from.opacity, to.opacity, t),
                fill = blendColor(from.fill, to.fill, t),
                stroke = blendColor(from.stroke, to.stroke, t),
                pathData = blendPath(from.pathData, to.pathData, t)
            )
        }

        private fun blendNumber(from: Float?, to: Float?, progress: Float): Float? = when {
            from != null && to != null -> from + (to - from) * progress
            to != null -> to
            else -> from
        }

        private fun blendColor(from: String?, to: String?, progress: Float): String? = when {
            from != null && to != null -> mixColor(from, to, progress)
            to != null -> to
            else -> from
        }

        private fun blendPath(from: String?, to: String?, progress: Float): String? {
            if (from.isNullOrBlank()) return to
            if (to.isNullOrBlank()) return from

            val fromPath = SvgPathData.parse(from)
            val toPath = SvgPathData.parse(to)

            return if (fromPath != null && toPath != null) {
                fromPath.morphTo(toPath, progress).toSvgString()
            } else if (progress < 0.5f) {
                from
            } else {
                to
            }
        }

        fun evaluateLayer(renderLayer: RenderLayer, frame: Float): LayerOverride {
            val override = LayerOverride()

            renderLayer.channels.forEach { (property, keyframes) ->
                when (val value = evaluateKeyframes(keyframes, frame)) {
                    is AnimValue.NumberValue -> when (property) {
                        "position.x" -> override.x = value.number
                        "position.y" -> override.y = value.number
                        "scale.x" -> override.scaleX = value.number
                        "scale.y" -> override.scaleY = value.number
                        "rotation" -> override.rotation = value.number
                        "opacity" -> override.opacity = value.number
                    }
                    is AnimValue.ColorValue -> when (property) {
                        "fill" -> override.fill = value.color
                        "stroke" -> override.stroke = value.color
                    }
                    is AnimValue.PathValue -> override.pathData = value.pathData
                    null -> Unit
                }
            }

            return override
        }

        private fun evaluateKeyframes(keyframes: List<Keyframe>, frame: Float): AnimValue? {
            if (keyframes.isEmpty()) return null
            if (frame <= keyframes.first().frame) return keyframes.first().value
            if (frame >= keyframes.last().frame) return keyframes.last().value

            val nextIndex = keyframes.indexOfFirst { it.frame >= frame }.coerceAtLeast(1)
            val previous = keyframes[nextIndex - 1]
            val next = keyframes[nextIndex]
            val duration = next.frame - previous.frame
            val progress = if (duration <= 0f) 1f else easingProgress(previous.easing, (frame - previous.frame) / duration)

            return interpolateValue(previous.value, next.value, progress)
        }

        private fun interpolateValue(from: AnimValue, to: AnimValue, progress: Float): AnimValue {
            return when {
                from is AnimValue.NumberValue && to is AnimValue.NumberValue ->
                    AnimValue.NumberValue(from.number + (to.number - from.number) * progress)
                from is AnimValue.ColorValue && to is AnimValue.ColorValue ->
                    AnimValue.ColorValue(mixColor(from.color, to.color, progress))
                from is AnimValue.PathValue && to is AnimValue.PathValue -> {
                    val fromPath = SvgPathData.parse(from.pathData)
                    val toPath = SvgPathData.parse(to.pathData)
                    val interpolated = if (fromPath != null && toPath != null) fromPath.morphTo(toPath, progress) else null
                    AnimValue.PathValue(interpolated?.toSvgString() ?: if (progress < 0.5f) from.pathData else to.pathData)
                }
                else -> if (progress < 0.5f) from else to
            }
        }
    }
}
