package com.example.stateanimdrive

data class StateAnimPackage(
    val label: String,
    val boardWidth: Float,
    val boardHeight: Float,
    val frameTransparent: Boolean,
    val faceParts: List<FacePart>,
    val variants: List<StateVariant>,
    val clips: Map<String, MotionClip>,
    val machine: StateMachine
)

data class FacePart(
    val pathData: String,
    val fill: String,
    val stroke: String?,
    val strokeWidth: Float
)

data class StateVariant(
    val stateId: String,
    val stateName: String,
    val clipId: String,
    val compiledUrl: String
)

data class MotionClip(
    val id: String,
    val name: String,
    val fps: Int,
    val frames: Int,
    val renderLayers: List<RenderLayer>,
    val renderLayerByKey: Map<String, RenderLayer>,
    val rootLayerKeys: List<String>
)

data class RenderLayer(
    val key: String,
    val label: String,
    val matchKey: String,
    val kind: String,
    val parentKey: String?,
    val width: Float,
    val height: Float,
    val baseX: Float,
    val baseY: Float,
    val baseScaleX: Float,
    val baseScaleY: Float,
    val baseRotation: Float,
    val baseOpacity: Float,
    val baseFill: String?,
    val baseStroke: String?,
    val baseStrokeWidth: Float,
    val radius: Float,
    val fillVisible: Boolean,
    val fillOpacity: Float,
    val strokeVisible: Boolean,
    val strokeOpacity: Float,
    val clipContent: Boolean,
    val faceParts: List<FacePart>,
    val channels: Map<String, List<Keyframe>>,
    val pivotX: Float,
    val pivotY: Float,
    val children: MutableList<String> = mutableListOf()
)

data class Keyframe(
    val frame: Float,
    val value: AnimValue,
    val easing: Easing
)

sealed class AnimValue {
    data class NumberValue(val number: Float) : AnimValue()
    data class ColorValue(val color: String) : AnimValue()
    data class PathValue(val pathData: String) : AnimValue()
}

sealed class Easing {
    object Linear : Easing()
    object Hold : Easing()
    data class CubicBezier(val x1: Float, val y1: Float, val x2: Float, val y2: Float) : Easing()
}

data class StateMachine(
    val id: String,
    val name: String,
    val params: List<MachineParam>,
    val layers: List<MachineLayer>
)

data class MachineParam(
    val id: String,
    val name: String,
    val type: String,
    val defaultValue: Any,
    val enumOptions: List<String>
)

data class MachineLayer(
    val id: String,
    val name: String,
    val role: String,
    val priority: Int,
    val defaultStateId: String,
    val states: List<MachineState>,
    val transitions: List<MachineTransition>,
    val control: ControlConfig?
)

data class MachineState(
    val id: String,
    val name: String,
    val clipId: String,
    val speed: Float,
    val loop: Boolean
)

data class MachineTransition(
    val id: String,
    val fromStateId: String,
    val toStateId: String,
    val conditions: List<TransitionCondition>,
    val durationFrames: Int,
    val effectMode: String,
    val targetFramePolicy: String,
    val onComplete: Boolean,
    val priority: Int,
    val consumeConditions: Boolean
)

data class TransitionCondition(
    val paramName: String,
    val operator: String,
    val value: Any
)

data class ControlConfig(
    val targetLayerId: String?,
    val targetScope: String?,
    val properties: Set<String>,
    val blendMode: String,
    val priority: Int
)

data class LayerOverride(
    var x: Float? = null,
    var y: Float? = null,
    var scaleX: Float? = null,
    var scaleY: Float? = null,
    var rotation: Float? = null,
    var opacity: Float? = null,
    var fill: String? = null,
    var stroke: String? = null,
    var pathData: String? = null
) {
    fun copyOverride(): LayerOverride = copy()

    fun mergeFrom(other: LayerOverride, properties: Set<String>? = null) {
        fun has(name: String) = properties == null || properties.contains(name)

        if (has("transform")) {
            other.x?.let { x = it }
            other.y?.let { y = it }
            other.scaleX?.let { scaleX = it }
            other.scaleY?.let { scaleY = it }
            other.rotation?.let { rotation = it }
        }
        if (has("opacity")) other.opacity?.let { opacity = it }
        if (has("fill")) other.fill?.let { fill = it }
        if (has("stroke")) other.stroke?.let { stroke = it }
        if (has("path")) other.pathData?.let { pathData = it }
    }
}

data class ProjectedLayerOverride(
    val override: LayerOverride = LayerOverride(),
    val propertyPriorities: MutableMap<String, Int> = mutableMapOf()
) {
    fun mergeFrom(other: LayerOverride, priority: Int) {
        fun setPriority(property: String) {
            propertyPriorities[property] = priority
        }

        if (other.x != null || other.y != null || other.scaleX != null || other.scaleY != null || other.rotation != null) {
            other.x?.let { override.x = it }
            other.y?.let { override.y = it }
            other.scaleX?.let { override.scaleX = it }
            other.scaleY?.let { override.scaleY = it }
            other.rotation?.let { override.rotation = it }
            setPriority("transform")
        }
        other.opacity?.let {
            override.opacity = it
            setPriority("opacity")
        }
        other.fill?.let {
            override.fill = it
            setPriority("fill")
        }
        other.stroke?.let {
            override.stroke = it
            setPriority("stroke")
        }
        other.pathData?.let {
            override.pathData = it
            setPriority("path")
        }
    }
}

data class ClipSample(
    val clip: MotionClip,
    val frame: Float,
    val alpha: Float
)

data class RenderPass(
    val clip: MotionClip,
    val frame: Float,
    val alpha: Float,
    val priority: Int,
    val layerOverrides: Map<String, LayerOverride> = emptyMap(),
    val includedLayerKeys: Set<String>? = null
)

data class RenderSnapshot(
    val passes: List<RenderPass>,
    val projectedOverrides: Map<String, ProjectedLayerOverride>,
    val status: String
)

data class PathBounds(
    val minX: Float,
    val minY: Float,
    val maxX: Float,
    val maxY: Float
) {
    val width: Float get() = maxX - minX
    val height: Float get() = maxY - minY
}
