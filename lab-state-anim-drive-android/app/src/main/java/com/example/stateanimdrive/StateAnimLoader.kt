package com.example.stateanimdrive

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.util.zip.ZipInputStream

class StateAnimLoader(private val context: Context) {
    fun load(assetName: String = DEFAULT_ASSET_NAME): StateAnimPackage {
        val entries = readZipEntries(assetName)
        val index = JSONObject(entries.getValue("index.json").decodeToString())
        val template = index.optArray("templates")?.optJSONObject(0)
            ?: error("Zip index.json does not contain templates[0].")
        val descriptorPath = template.optString("descriptor")
        val descriptor = JSONObject(entries.getValue(descriptorPath).decodeToString())
        val descriptorBase = dirname(descriptorPath)
        val descriptorFaceParts = parseFaceParts(descriptor.optArray("faceParts"))
        val variants = parseVariants(descriptor)
        val clips = variants.associate { variant ->
            val compiledPath = joinPath(descriptorBase, variant.compiledUrl)
            val compiled = JSONObject(entries.getValue(compiledPath).decodeToString())
            variant.clipId to parseMotionClip(variant, compiled, descriptorFaceParts)
        }
        val machine = parseStateMachine(descriptor.optObject("stateMachine"), variants)

        return StateAnimPackage(
            label = descriptor.optString("label", template.optString("label", "State Anim")),
            boardWidth = descriptor.optObject("boardBounds")?.optDouble("width", 640.0)?.toFloat() ?: 640f,
            boardHeight = descriptor.optObject("boardBounds")?.optDouble("height", 640.0)?.toFloat() ?: 640f,
            frameTransparent = descriptor.optBoolean("frameTransparent", false),
            faceParts = descriptorFaceParts,
            variants = variants,
            clips = clips,
            machine = machine
        )
    }

    private fun readZipEntries(assetName: String): Map<String, ByteArray> {
        val entries = linkedMapOf<String, ByteArray>()

        context.assets.open(assetName).use { input ->
            ZipInputStream(BufferedInputStream(input), Charsets.UTF_8).use { zip ->
                while (true) {
                    val entry = zip.nextEntry ?: break
                    if (!entry.isDirectory) {
                        entries[entry.name.trimStart('/')] = zip.readBytes()
                    }
                    zip.closeEntry()
                }
            }
        }

        return entries
    }

    private fun parseVariants(descriptor: JSONObject): List<StateVariant> {
        return descriptor.optArray("variants").orEmptyObjects().mapIndexed { index, item ->
            val stateId = item.optString("stateId", item.optString("id", "state-$index"))
            StateVariant(
                stateId = stateId,
                stateName = item.optString("stateName", item.optString("name", stateId)),
                clipId = item.optString("clipId", stateId),
                compiledUrl = item.optString("compiledUrl", item.optString("motionUrl", item.optString("url")))
            )
        }
    }

    private fun parseMotionClip(
        variant: StateVariant,
        compiled: JSONObject,
        descriptorFaceParts: List<FacePart>
    ): MotionClip {
        val fps = compiled.optInt("fps", 30).coerceAtLeast(1)
        val frames = compiled.optInt("frames", 1).coerceAtLeast(1)
        val motionFaceParts = compiled.optObject("templateResource")
            ?.optArray("faceParts")
            ?.let(::parseFaceParts)
            ?: emptyList()
        val layerDefs = compiled.optArray("layerDefs").orEmptyObjects().mapIndexed { index, raw ->
            parseLayerDef(raw, index)
        }
        val rawLayers = compiled.optObject("layers") ?: JSONObject()
        val layerDefByKey = layerDefs.associateBy { it.key }
        val offsets = layerDefs.associate { layerDef ->
            val offset = if (layerDef.kind == "frame" || layerDef.kind == "group") {
                0f to 0f
            } else {
                val firstPart = getLayerFaceParts(layerDef, motionFaceParts, descriptorFaceParts).firstOrNull()
                val pathSource = firstRawString(rawLayers.optObject(layerDef.key), "path") ?: firstPart?.pathData
                val bounds = SvgPathData.parse(pathSource)?.bounds()
                (bounds?.minX ?: 0f) to (bounds?.minY ?: 0f)
            }
            layerDef.key to offset
        }
        val absolutePositionCache = mutableMapOf<String, Pair<Float, Float>>()

        fun absolutePosition(layerDef: RawLayerDef): Pair<Float, Float> {
            absolutePositionCache[layerDef.key]?.let { return it }

            val rawChannels = rawLayers.optObject(layerDef.key)
            val offset = offsets.getValue(layerDef.key)
            val x = firstRawNumber(rawChannels, "position.x")
                ?: layerDef.initial["position.x"]
                ?: layerDef.initial["x"]
                ?: 0f
            val y = firstRawNumber(rawChannels, "position.y")
                ?: layerDef.initial["position.y"]
                ?: layerDef.initial["y"]
                ?: 0f
            val result = x + offset.first to y + offset.second
            absolutePositionCache[layerDef.key] = result
            return result
        }

        fun parentAbsolutePosition(layerDef: RawLayerDef): Pair<Float, Float> {
            val parent = layerDef.parentKey?.let { layerDefByKey[it] }
            return parent?.let { absolutePosition(it) } ?: (0f to 0f)
        }

        val renderLayers = layerDefs.map { layerDef ->
            val rawChannels = rawLayers.optObject(layerDef.key) ?: JSONObject()
            val offset = offsets.getValue(layerDef.key)
            val parentPosition = parentAbsolutePosition(layerDef)
            val absolutePosition = absolutePosition(layerDef)
            val relativeBaseX = absolutePosition.first - parentPosition.first
            val relativeBaseY = absolutePosition.second - parentPosition.second
            val normalizedChannels = parseChannels(rawChannels, layerDef, offset, parentPosition)
            val layerFaceParts = getLayerFaceParts(layerDef, motionFaceParts, descriptorFaceParts)
                .map { facePart -> facePart.translated(-offset.first, -offset.second) }
            val firstPath = firstPathValue(normalizedChannels)
                ?: layerFaceParts.firstOrNull()?.pathData
            val pathBounds = SvgPathData.parse(firstPath)?.bounds()
            val width = layerDef.boundsWidth ?: pathBounds?.width?.takeIf { it > 0f } ?: 1f
            val height = layerDef.boundsHeight ?: pathBounds?.height?.takeIf { it > 0f } ?: 1f
            val pivotX = pathBounds?.let { it.minX + it.width / 2f } ?: (width / 2f)
            val pivotY = pathBounds?.let { it.minY + it.height / 2f } ?: (height / 2f)
            val firstPart = layerFaceParts.firstOrNull()

            RenderLayer(
                key = layerDef.key,
                label = layerDef.label,
                matchKey = layerDef.matchKey,
                kind = layerDef.kind,
                parentKey = layerDef.parentKey,
                width = width,
                height = height,
                baseX = firstNumberValue(normalizedChannels, "position.x") ?: relativeBaseX,
                baseY = firstNumberValue(normalizedChannels, "position.y") ?: relativeBaseY,
                baseScaleX = firstNumberValue(normalizedChannels, "scale.x") ?: 1f,
                baseScaleY = firstNumberValue(normalizedChannels, "scale.y") ?: 1f,
                baseRotation = firstNumberValue(normalizedChannels, "rotation") ?: 0f,
                baseOpacity = firstNumberValue(normalizedChannels, "opacity") ?: 1f,
                baseFill = firstColorValue(normalizedChannels, "fill")
                    ?: layerDef.frameFill
                    ?: firstPart?.fill,
                baseStroke = firstColorValue(normalizedChannels, "stroke")
                    ?: layerDef.frameStroke
                    ?: firstPart?.stroke,
                baseStrokeWidth = layerDef.frameStrokeWidth ?: firstPart?.strokeWidth ?: 0f,
                radius = layerDef.frameRadius ?: 0f,
                fillVisible = layerDef.frameFillVisible ?: (layerDef.kind != "frame" || layerDef.frameFill != null),
                fillOpacity = layerDef.frameFillOpacity ?: 1f,
                strokeVisible = layerDef.frameStrokeVisible ?: ((layerDef.frameStrokeWidth ?: firstPart?.strokeWidth ?: 0f) > 0f),
                strokeOpacity = layerDef.frameStrokeOpacity ?: 1f,
                clipContent = layerDef.frameClipContent ?: false,
                faceParts = layerFaceParts,
                channels = normalizedChannels,
                pivotX = pivotX,
                pivotY = pivotY
            )
        }

        val renderLayerByKey = renderLayers.associateBy { it.key }
        renderLayers.forEach { layer ->
            val parent = layer.parentKey?.let { renderLayerByKey[it] }
            parent?.children?.add(layer.key)
        }
        val rootLayerKeys = renderLayers
            .filter { it.parentKey == null || !renderLayerByKey.containsKey(it.parentKey) }
            .map { it.key }

        return MotionClip(
            id = variant.clipId,
            name = variant.stateName,
            fps = fps,
            frames = frames,
            renderLayers = renderLayers,
            renderLayerByKey = renderLayerByKey,
            rootLayerKeys = rootLayerKeys
        )
    }

    private fun parseChannels(
        rawChannels: JSONObject,
        layerDef: RawLayerDef,
        offset: Pair<Float, Float>,
        parentPosition: Pair<Float, Float>
    ): Map<String, List<Keyframe>> {
        val channels = linkedMapOf<String, List<Keyframe>>()

        rawChannels.keys().forEach { rawProperty ->
            val property = normalizeProperty(rawProperty)
            val keyframes = parseKeyframes(rawChannels.optArray(rawProperty), property, offset, parentPosition)
            if (keyframes.isNotEmpty()) {
                channels[property] = keyframes
            }
        }

        layerDef.initial.forEach { (rawProperty, value) ->
            val property = normalizeProperty(rawProperty)
            if (!channels.containsKey(property)) {
                val adjusted = when (property) {
                    "position.x" -> AnimValue.NumberValue(value + offset.first - parentPosition.first)
                    "position.y" -> AnimValue.NumberValue(value + offset.second - parentPosition.second)
                    else -> AnimValue.NumberValue(value)
                }
                channels[property] = listOf(Keyframe(0f, adjusted, Easing.Linear))
            }
        }

        return channels
    }

    private fun parseKeyframes(
        rawKeyframes: JSONArray?,
        property: String,
        offset: Pair<Float, Float>,
        parentPosition: Pair<Float, Float>
    ): List<Keyframe> {
        if (rawKeyframes == null) return emptyList()

        return (0 until rawKeyframes.length()).mapNotNull { index ->
            val item = rawKeyframes.opt(index)
            val frame: Float
            val rawValue: Any?
            val easing: Easing

            if (item is JSONArray) {
                frame = item.optDouble(0, 0.0).toFloat().coerceAtLeast(0f)
                rawValue = item.opt(1)
                easing = parseEasing(item.opt(2))
            } else if (item is JSONObject) {
                if (item.optString("source") == "export-static-default") return@mapNotNull null
                frame = item.optDouble("frame", 0.0).toFloat().coerceAtLeast(0f)
                rawValue = item.opt("value")
                easing = parseEasing(item.opt("easing"))
            } else {
                return@mapNotNull null
            }

            val value = when (property) {
                "position.x" -> AnimValue.NumberValue(rawValue.asFloat() + offset.first - parentPosition.first)
                "position.y" -> AnimValue.NumberValue(rawValue.asFloat() + offset.second - parentPosition.second)
                "scale.x", "scale.y", "rotation", "opacity" -> AnimValue.NumberValue(rawValue.asFloat(1f))
                "fill", "stroke" -> AnimValue.ColorValue(normalizeHexColor(rawValue as? String))
                "path" -> {
                    val path = (rawValue as? String).orEmpty()
                    val normalized = SvgPathData.parse(path)?.translated(-offset.first, -offset.second)?.toSvgString() ?: path
                    AnimValue.PathValue(normalized)
                }
                else -> null
            }

            value?.let { Keyframe(frame, it, easing) }
        }.sortedBy { it.frame }
    }

    private fun parseFaceParts(array: JSONArray?): List<FacePart> {
        return array.orEmptyObjects().map { item ->
            FacePart(
                pathData = item.optString("d"),
                fill = normalizeHexColor(item.optStringOrNull("fill"), "#000000"),
                stroke = item.optStringOrNull("stroke")?.let { normalizeHexColor(it, "#000000") },
                strokeWidth = item.optDouble("strokeWidth", 0.0).toFloat().coerceAtLeast(0f)
            )
        }
    }

    private fun parseLayerDef(raw: JSONObject, index: Int): RawLayerDef {
        val motionKey = raw.optString("motionKey", raw.optString("id", "layer-$index"))
        val initial = mutableMapOf<String, Float>()
        raw.optObject("initial")?.keys()?.forEach { key ->
            initial[normalizeProperty(key)] = raw.optObject("initial")?.optDouble(key, 0.0)?.toFloat() ?: 0f
        }

        val bounds = raw.optObject("bounds")
        val frame = raw.optObject("frame")

        return RawLayerDef(
            key = motionKey,
            label = raw.optString("label", raw.optString("name", motionKey)),
            matchKey = raw.optString("transitionMatchKey", raw.optString("label", motionKey)),
            kind = raw.optString("kind", raw.optString("type", "pen")).lowercase(),
            partIndexes = raw.optArray("partIndexes")?.let { array ->
                (0 until array.length()).map { array.optInt(it) }
            } ?: emptyList(),
            initial = initial,
            boundsWidth = bounds?.optFloatOrNull("width"),
            boundsHeight = bounds?.optFloatOrNull("height"),
            parentKey = raw.optStringOrNull("parentMotionKey"),
            frameFill = frame?.optStringOrNull("fill")?.let { normalizeHexColor(it, "#FFFFFF") },
            frameFillOpacity = frame?.optFloatOrNull("fillOpacity"),
            frameFillVisible = frame?.takeIf { it.has("fillVisible") }?.optBoolean("fillVisible"),
            frameStroke = frame?.optStringOrNull("stroke")?.let { normalizeHexColor(it, "#000000") },
            frameStrokeOpacity = frame?.optFloatOrNull("strokeOpacity"),
            frameStrokeVisible = frame?.takeIf { it.has("strokeVisible") }?.optBoolean("strokeVisible"),
            frameStrokeWidth = frame?.optFloatOrNull("strokeWidth"),
            frameRadius = frame?.optFloatOrNull("radius"),
            frameClipContent = frame?.takeIf { it.has("clipContent") }?.optBoolean("clipContent")
        )
    }

    private fun parseStateMachine(machine: JSONObject?, variants: List<StateVariant>): StateMachine {
        if (machine == null) {
            val states = variants.map { variant ->
                MachineState(variant.stateId, variant.stateName, variant.clipId, 1f, true)
            }

            return StateMachine(
                id = "fallback-machine",
                name = "State Anim",
                params = listOf(
                    MachineParam(
                        id = "param-state",
                        name = "状态切换",
                        type = "enum",
                        defaultValue = states.firstOrNull()?.name.orEmpty(),
                        enumOptions = states.map { it.name }
                    )
                ),
                layers = listOf(
                    MachineLayer(
                        id = "base-layer",
                        name = "Action",
                        role = "motion",
                        priority = 0,
                        defaultStateId = states.firstOrNull()?.id.orEmpty(),
                        states = states,
                        transitions = states.mapIndexed { index, state ->
                            MachineTransition(
                                id = "to-${state.id}",
                                fromStateId = "any",
                                toStateId = state.id,
                                conditions = listOf(TransitionCondition("状态切换", "==", state.name)),
                                durationFrames = 8,
                                effectMode = "none",
                                targetFramePolicy = "first-frame",
                                onComplete = false,
                                priority = index,
                                consumeConditions = false
                            )
                        },
                        control = null
                    )
                )
            )
        }

        val params = machine.optArray("params").orEmptyObjects().mapIndexed { index, item ->
            val type = if (item.optString("type") == "boolean") "bool" else item.optString("type", "enum")
            val enumOptions = item.optArray("enumOptions")?.strings()
                ?: item.optArray("options")?.strings()
                ?: emptyList()
            MachineParam(
                id = item.optString("id", "param-$index"),
                name = item.optString("name", item.optString("id", "param${index + 1}")),
                type = type,
                defaultValue = jsonValue(item, "defaultValue")
                    ?: jsonValue(item, "value")
                    ?: enumOptions.firstOrNull()
                    ?: if (type == "number") 0f else false,
                enumOptions = enumOptions
            )
        }

        val layers = machine.optArray("layers").orEmptyObjects().mapIndexed { layerIndex, layerJson ->
            val states = layerJson.optArray("states").orEmptyObjects().mapIndexed { stateIndex, stateJson ->
                MachineState(
                    id = stateJson.optString("id", "state-$layerIndex-$stateIndex"),
                    name = stateJson.optString("name", stateJson.optString("stateName", "State ${stateIndex + 1}")),
                    clipId = stateJson.optString("clipId", stateJson.optString("clipRef", stateJson.optString("id"))),
                    speed = stateJson.optDouble("speed", 1.0).toFloat(),
                    loop = stateJson.optBoolean("loop", true)
                )
            }

            MachineLayer(
                id = layerJson.optString("id", "layer-$layerIndex"),
                name = layerJson.optString("name", "Layer ${layerIndex + 1}"),
                role = layerJson.optString("layerRole", layerJson.optString("role", if (layerJson.has("control")) "control" else "motion")),
                priority = layerJson.optInt("priority", layerIndex),
                defaultStateId = layerJson.optString("defaultStateId", layerJson.optString("entryStateId", states.firstOrNull()?.id.orEmpty())),
                states = states,
                transitions = layerJson.optArray("transitions").orEmptyObjects().mapIndexed { transitionIndex, transitionJson ->
                    parseTransition(transitionJson, transitionIndex)
                }.filter { it.toStateId.isNotBlank() },
                control = layerJson.optObject("control")?.let { controlJson ->
                    ControlConfig(
                        targetLayerId = controlJson.optStringOrNull("targetLayerId"),
                        targetScope = controlJson.optStringOrNull("targetScope"),
                        properties = controlJson.optArray("properties")?.strings()?.toSet() ?: emptySet(),
                        blendMode = controlJson.optString("blendMode", "replace"),
                        priority = controlJson.optInt("priority", layerJson.optInt("priority", layerIndex))
                    )
                }
            )
        }

        return StateMachine(
            id = machine.optString("id", "state-anim-machine"),
            name = machine.optString("name", "State Anim Machine"),
            params = params,
            layers = layers
        )
    }

    private fun parseTransition(item: JSONObject, index: Int): MachineTransition {
        return MachineTransition(
            id = item.optString("id", "transition-$index"),
            fromStateId = item.optString("fromStateId", item.optString("from", "any")),
            toStateId = item.optString("toStateId", item.optString("to", "")),
            conditions = item.optArray("conditions").orEmptyObjects().mapNotNull { condition ->
                val paramName = condition.optString("paramName", condition.optString("param", condition.optString("name")))
                if (paramName.isBlank()) {
                    null
                } else {
                    TransitionCondition(
                        paramName = paramName,
                        operator = condition.optString("operator", "=="),
                        value = jsonValue(condition, "value")
                            ?: jsonValue(condition, "equals")
                            ?: jsonValue(condition, "is")
                            ?: true
                    )
                }
            },
            durationFrames = item.optDouble("durationFrames", item.optDouble("duration", 0.0)).toInt().coerceAtLeast(0),
            effectMode = item.optObject("effect")?.optString("mode", "none") ?: "none",
            targetFramePolicy = item.optObject("effect")?.optString("targetFramePolicy", "first-frame") ?: "first-frame",
            onComplete = item.optBoolean("onComplete", false),
            priority = item.optInt("priority", 0),
            consumeConditions = item.optBoolean("consumeConditions", false)
        )
    }

    private fun parseEasing(raw: Any?): Easing {
        if (raw is JSONObject && raw.optString("type") == "cubic-bezier") {
            val points = raw.optArray("points")
            if (points != null && points.length() >= 4) {
                return Easing.CubicBezier(
                    points.optDouble(0, 0.0).toFloat(),
                    points.optDouble(1, 0.0).toFloat(),
                    points.optDouble(2, 1.0).toFloat(),
                    points.optDouble(3, 1.0).toFloat()
                )
            }
        }

        return when (raw as? String) {
            "hold" -> Easing.Hold
            "natural" -> Easing.CubicBezier(0.33f, 0f, 0.2f, 1f)
            "smooth", "ease-in-out" -> Easing.CubicBezier(0.37f, 0f, 0.63f, 1f)
            "slow-down", "ease-out" -> Easing.CubicBezier(0f, 0f, 0.2f, 1f)
            "accelerate", "ease-in" -> Easing.CubicBezier(0.4f, 0f, 1f, 1f)
            "overshoot" -> Easing.CubicBezier(0.34f, 1.25f, 0.64f, 1f)
            else -> Easing.Linear
        }
    }

    private fun getLayerFaceParts(
        layerDef: RawLayerDef,
        motionFaceParts: List<FacePart>,
        descriptorFaceParts: List<FacePart>
    ): List<FacePart> {
        return layerDef.partIndexes.mapNotNull { index ->
            motionFaceParts.getOrNull(index) ?: descriptorFaceParts.getOrNull(index)
        }
    }

    private fun FacePart.translated(dx: Float, dy: Float): FacePart {
        val translated = SvgPathData.parse(pathData)?.translated(dx, dy)?.toSvgString() ?: pathData
        return copy(pathData = translated)
    }

    private fun firstRawNumber(rawChannels: JSONObject?, property: String): Float? {
        return firstRawValue(rawChannels, property)?.asFloat()
    }

    private fun firstRawString(rawChannels: JSONObject?, property: String): String? {
        return firstRawValue(rawChannels, property) as? String
    }

    private fun firstRawValue(rawChannels: JSONObject?, property: String): Any? {
        if (rawChannels == null) return null
        val rawArray = rawChannels.optArray(property) ?: return null
        val first = rawArray.opt(0)
        return when (first) {
            is JSONArray -> first.opt(1)
            is JSONObject -> if (first.optString("source") == "export-static-default") null else first.opt("value")
            else -> null
        }
    }

    private fun firstNumberValue(channels: Map<String, List<Keyframe>>, property: String): Float? =
        (channels[property]?.firstOrNull()?.value as? AnimValue.NumberValue)?.number

    private fun firstColorValue(channels: Map<String, List<Keyframe>>, property: String): String? =
        (channels[property]?.firstOrNull()?.value as? AnimValue.ColorValue)?.color

    private fun firstPathValue(channels: Map<String, List<Keyframe>>): String? =
        (channels["path"]?.firstOrNull()?.value as? AnimValue.PathValue)?.pathData

    private fun normalizeProperty(property: String): String = when (property) {
        "x", "positionX" -> "position.x"
        "y", "positionY" -> "position.y"
        "scaleX" -> "scale.x"
        "scaleY" -> "scale.y"
        else -> property
    }

    private fun jsonValue(json: JSONObject, key: String): Any? {
        if (!json.has(key) || json.isNull(key)) return null
        return when (val value = json.get(key)) {
            is Number -> value.toFloat()
            is Boolean -> value
            is String -> value
            else -> value.toString()
        }
    }

    private fun JSONArray?.orEmptyObjects(): List<JSONObject> = this?.objects() ?: emptyList()

    private fun JSONObject.optFloatOrNull(name: String): Float? =
        if (has(name) && !isNull(name)) optDouble(name).toFloat() else null

    private fun dirname(path: String): String {
        val index = path.lastIndexOf('/')
        return if (index >= 0) path.take(index + 1) else ""
    }

    private fun joinPath(basePath: String, relativePath: String): String {
        val stack = mutableListOf<String>()
        "$basePath$relativePath".split('/').forEach { part ->
            when {
                part.isBlank() || part == "." -> Unit
                part == ".." -> if (stack.isNotEmpty()) stack.removeAt(stack.lastIndex)
                else -> stack += part
            }
        }
        return stack.joinToString("/")
    }

    private data class RawLayerDef(
        val key: String,
        val label: String,
        val matchKey: String,
        val kind: String,
        val partIndexes: List<Int>,
        val initial: Map<String, Float>,
        val boundsWidth: Float?,
        val boundsHeight: Float?,
        val parentKey: String?,
        val frameFill: String?,
        val frameFillOpacity: Float?,
        val frameFillVisible: Boolean?,
        val frameStroke: String?,
        val frameStrokeOpacity: Float?,
        val frameStrokeVisible: Boolean?,
        val frameStrokeWidth: Float?,
        val frameRadius: Float?,
        val frameClipContent: Boolean?
    )

    companion object {
        const val DEFAULT_ASSET_NAME = "state_anim_robot.zip"
    }
}
