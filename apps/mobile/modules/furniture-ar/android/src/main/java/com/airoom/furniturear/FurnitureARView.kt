package com.airoom.furniturear

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.MotionEvent
import android.view.PixelCopy
import android.view.ViewConfiguration
import androidx.activity.ComponentActivity
import com.google.android.filament.Material
import com.google.android.filament.MaterialInstance
import com.google.android.filament.utils.KTX1Loader
import com.google.ar.core.Anchor
import com.google.ar.core.Config
import com.google.ar.core.Frame
import com.google.ar.core.HitResult
import com.google.ar.core.HostCloudAnchorFuture
import com.google.ar.core.ResolveCloudAnchorFuture
import com.google.ar.core.Plane
import com.google.ar.core.Pose
import com.google.ar.core.Session
import com.google.ar.core.Trackable
import com.google.ar.core.TrackingState
import com.google.ar.core.exceptions.UnavailableException
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import io.github.sceneview.ar.ARSceneView
import io.github.sceneview.ar.camera.ARCameraStream
import io.github.sceneview.ar.node.AnchorNode
import io.github.sceneview.ar.scene.PlaneRenderer
import io.github.sceneview.environment.Environment
import io.github.sceneview.math.Position
import io.github.sceneview.math.Rotation
import io.github.sceneview.math.Size
import io.github.sceneview.math.Direction
import io.github.sceneview.node.CubeNode
import io.github.sceneview.node.PlaneNode
import io.github.sceneview.node.ModelNode
import io.github.sceneview.node.Node
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin

/**
 * Native AR view (Android): ARCore + SceneView.
 *
 * Implements the contract in `src/FurnitureAR.types.ts`. Gestures (select, drag, twist)
 * are handled here, natively, so per-frame poses never cross the JS bridge
 * (CLAUDE.md 4.3 / 4.4); collisions are checked in [validateMove].
 *
 * Floor items stand on the floor and turn around Y. Wall items (category `wall-art`) hang on
 * a wall: placed where the screen center hits a vertical plane, facing out of it, dragged
 * along the wall's plane, never rotated (CLAUDE.md 4.2-4.4).
 *
 * On-scene controls: the selected item shows four move arrows around it (tap = one step,
 * hold = repeat); a double tap on an item shows a trash button over it instead, and tapping
 * that deletes the item (`onItemRemoved`).
 */
class FurnitureARView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {

  // Let Android measure the SurfaceView child; React Native does not lay out native children.
  override val shouldUseAndroidLayout = true

  private val onTrackingStateChanged by EventDispatcher<Map<String, Any?>>()
  private val onPlaneDetected by EventDispatcher<Map<String, Any?>>()
  private val onItemPlaced by EventDispatcher<Map<String, Any?>>()
  private val onItemSelected by EventDispatcher<Map<String, Any?>>()
  private val onPlacementBlocked by EventDispatcher<Map<String, Any?>>()
  private val onItemTapped by EventDispatcher<Map<String, Any?>>()
  private val onItemRemoved by EventDispatcher<Map<String, Any?>>()
  private val onError by EventDispatcher<Map<String, Any?>>()

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private val mainHandler = Handler(Looper.getMainLooper())
  private val modelCache = ModelCache(context)
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop.toFloat()

  private var sceneView: ARSceneView? = null
  /** Our camera stream (custom occlusion material); SceneView only destroys its default one. */
  private var cameraStream: ARCameraStream? = null
  /** Neutral studio lighting (ambient + reflections); we own and destroy it. */
  private var neutralIbl: KTX1Loader.IndirectLightBundle? = null
  private val items = LinkedHashMap<String, PlacedItem>()
  private var selected: PlacedItem? = null

  private var lastTrackingState: String? = null
  private var floorCount = -1
  private var wallCount = -1
  /** Detected walls as floor segments, refreshed when ARCore updates planes. */
  private var walls: List<CollisionMath.Wall> = emptyList()
  /** Height of the lowest tracked upward plane; horizontal hits well above it are not "floor". */
  private var floorY: Float? = null
  private var depthSupported = false
  private var showPlaneOverlay = true
  private var destroyed = false

  private lateinit var footprintSelected: MaterialInstance
  private lateinit var footprintBlocked: MaterialInstance
  /** Procedural soft shadow under each item (src/main/materials/furniture_contact_shadow.mat). */
  private lateinit var contactShadowMaterial: Material

  /** Move arrows and trash button (src/main/materials/furniture_icon.mat), shared by all items. */
  private lateinit var iconMaterial: Material
  private val iconMaterialInstances = mutableListOf<MaterialInstance>()
  private lateinit var floorArrows: Map<ArMath.Handle, PlaneNode>
  private lateinit var wallArrows: Map<ArMath.Handle, PlaneNode>
  private lateinit var trashButton: PlaneNode
  /** Item showing the trash button (double tapped); always the selected one. */
  private var trashItem: PlacedItem? = null
  /** Controls hidden while a snapshot is taken. */
  private var controlsHidden = false

  init {
    val activity = appContext.currentActivity as? ComponentActivity
    if (activity == null) {
      post { emitError("AR_UNAVAILABLE", "AR view needs a running activity.") }
    } else {
      createSceneView(activity)
    }
  }

  // ---------------------------------------------------------------------------------------
  // Setup / teardown
  // ---------------------------------------------------------------------------------------

  private fun createSceneView(activity: ComponentActivity) {
    val view = ARSceneView(
      context = context,
      sharedActivity = activity,
      sessionConfiguration = ::configureSession,
      onSessionCreated = ::onSessionCreated,
      onSessionFailed = ::onSessionFailed,
      onSessionUpdated = ::onSessionUpdated,
      onGestureListener = null,
      onTouchEvent = { event, _ -> handleTouch(event) },
    )
    // The JS screen asks for the camera permission before mounting this view (with its own
    // message and "open settings" path), so SceneView must not show its own prompt/toast.
    view.arCore.checkCameraPermission = false

    // Our occlusion material adds a depth margin; SceneView's default cut holes in models
    // up close and while moving (see src/main/materials/furniture_camera_depth.mat).
    view.cameraStream = ARCameraStream(
      materialLoader = view.materialLoader,
      depthOcclusionMaterialFile = DEPTH_OCCLUSION_MATERIAL,
    ).also { cameraStream = it }

    // Lighting. SceneView's AR environment has NO ambient light (indirectLight = null) and
    // relies on its ENVIRONMENTAL_HDR integration, which on device (Galaxy Z Flip6) gave a green
    // cast and near-black ambient (forward/inward faces black). Instead: a fixed neutral studio
    // IBL for ambient + reflections, and AMBIENT_INTENSITY estimation (normalized color
    // correction + brightness on the main light) so furniture still follows the room's light.
    neutralIbl = loadNeutralIndirectLight(view)?.also { ibl ->
      view.environment = Environment(indirectLight = ibl.indirectLight, skybox = null)
    }

    view.planeRenderer.apply {
      planeRendererMode = PlaneRenderer.PlaneRendererMode.RENDER_ALL
      isShadowReceiver = true // light-driven shadows on detected planes, even when the grid is hidden
      isVisible = showPlaneOverlay
    }

    footprintSelected = view.materialLoader.createColorInstance(Color.argb(70, 255, 255, 255))
    footprintBlocked = view.materialLoader.createColorInstance(Color.argb(140, 230, 40, 40))
    contactShadowMaterial = view.materialLoader.createMaterial(CONTACT_SHADOW_MATERIAL)
    createControls(view)

    addView(view, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    sceneView = view
    // Attaching the lifecycle last: it replays CREATED/RESUMED and starts ARCore.
    view.lifecycle = activity.lifecycle
  }

  /** SceneView's bundled neutral studio IBL (assets/environments/neutral/neutral_ibl.ktx). */
  private fun loadNeutralIndirectLight(view: ARSceneView): KTX1Loader.IndirectLightBundle? = runCatching {
    val bytes = context.assets.open(NEUTRAL_IBL_ASSET).use { it.readBytes() }
    val buffer = ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder()).put(bytes).apply { flip() }
    KTX1Loader.createIndirectLight(view.engine, buffer).also { it.indirectLight?.intensity = NEUTRAL_IBL_INTENSITY }
  }.onFailure { Log.w(TAG, "Could not load neutral IBL", it) }.getOrNull()

  private fun configureSession(session: Session, config: Config) {
    config.planeFindingMode = Config.PlaneFindingMode.HORIZONTAL_AND_VERTICAL
    // See createSceneView: ENVIRONMENTAL_HDR via SceneView 2.3.4 tints/darkens materials.
    config.lightEstimationMode = Config.LightEstimationMode.AMBIENT_INTENSITY
    config.instantPlacementMode = Config.InstantPlacementMode.DISABLED
    // Depth API enables occlusion (people and objects in front of furniture) where supported.
    depthSupported = session.isDepthModeSupported(Config.DepthMode.AUTOMATIC)
    config.depthMode = if (depthSupported) Config.DepthMode.AUTOMATIC else Config.DepthMode.DISABLED
    // Saved scenes come back at the same spot in the room (hostItemAnchor / resolveCloudAnchor).
    config.cloudAnchorMode = Config.CloudAnchorMode.ENABLED
  }

  private fun onSessionCreated(session: Session) {
    sceneView?.cameraStream?.isDepthOcclusionEnabled = DEPTH_OCCLUSION_ENABLED && depthSupported
  }

  private fun onSessionFailed(exception: Exception) {
    Log.w(TAG, "AR session failed", exception)
    emitTrackingState("notAvailable")
    when (exception) {
      is SecurityException ->
        emitError("CAMERA_PERMISSION_DENIED", "Camera access is needed to show furniture in your room.")
      is UnavailableException ->
        emitError("AR_UNAVAILABLE", "This device does not support AR (ARCore).")
      else ->
        emitError("SESSION_FAILED", exception.message ?: "Could not start AR.")
    }
  }

  fun setShowPlaneOverlay(show: Boolean) {
    showPlaneOverlay = show
    sceneView?.planeRenderer?.isVisible = show
  }

  fun destroy() {
    if (destroyed) return
    destroyed = true
    cancelCloudAnchorTasks()
    scope.cancel()
    mainHandler.removeCallbacksAndMessages(null)
    // Controls first: they may be children of an item that is about to be destroyed.
    if (::trashButton.isInitialized) controlNodes().forEach { detachControl(it) }
    items.values.toList().forEach { destroyItem(it) }
    items.clear()
    sceneView?.let { view ->
      if (::trashButton.isInitialized) {
        controlNodes().forEach { runCatching { it.destroy() } }
        iconMaterialInstances.forEach { runCatching { view.materialLoader.destroyMaterialInstance(it) } }
      }
      view.lifecycle = null
      view.cameraStream = null
      runCatching { cameraStream?.destroy() }
      runCatching { view.destroy() }
      neutralIbl?.let { ibl ->
        ibl.indirectLight?.let { runCatching { view.engine.destroyIndirectLight(it) } }
        ibl.cubemap?.let { runCatching { view.engine.destroyTexture(it) } }
      }
      removeView(view)
    }
    cameraStream = null
    neutralIbl = null
    sceneView = null
  }

  // ---------------------------------------------------------------------------------------
  // Per-frame updates: tracking state and plane detection
  // ---------------------------------------------------------------------------------------

  private fun onSessionUpdated(session: Session, frame: Frame) {
    emitTrackingState(
      when (frame.camera.trackingState) {
        TrackingState.TRACKING -> "normal"
        TrackingState.PAUSED -> "limited"
        else -> "notAvailable"
      },
    )
    if (frame.getUpdatedTrackables(Plane::class.java).isNotEmpty()) {
      updatePlanes(session)
    }
    refineWallItems(frame)
    settleFloorItems(frame)
    followCloudAnchors()
    faceTrashToCamera(frame)
    checkPendingHosts(session, frame)
    settleResolvedAnchors()
  }

  private fun updatePlanes(session: Session) {
    val planes = session.getAllTrackables(Plane::class.java)
      .filter { it.trackingState == TrackingState.TRACKING && it.subsumedBy == null }
    val upward = planes.filter { it.type == Plane.Type.HORIZONTAL_UPWARD_FACING }
    val lowest = upward.minOfOrNull { it.centerPose.ty() }
    floorY = lowest

    val floors = if (lowest == null) 0 else upward.count { it.centerPose.ty() <= lowest + FLOOR_TOLERANCE_M }
    val vertical = planes.filter { it.type == Plane.Type.VERTICAL }
    walls = vertical.mapNotNull { plane -> wallSegment(plane)?.let { CollisionMath.Wall(plane.hashCode().toString(), it) } }

    if (floors != floorCount) {
      floorCount = floors
      onPlaneDetected(mapOf("kind" to "floor", "count" to floors))
    }
    if (vertical.size != wallCount) {
      wallCount = vertical.size
      onPlaneDetected(mapOf("kind" to "wall", "count" to vertical.size))
    }
  }

  /**
   * A vertical plane as a segment on the floor (X/Z): its detected polygon projected onto the
   * horizontal line through its center, perpendicular to its normal. Tiny scraps are ignored.
   */
  private fun wallSegment(plane: Plane): CollisionMath.Segment? {
    val pose = plane.centerPose
    val normal = pose.yAxis // a plane's local +Y is its normal
    val len = hypot(normal[0], normal[2])
    if (len < 0.5f) return null // not vertical enough to be a wall
    val dirX = -normal[2] / len
    val dirZ = normal[0] / len

    val polygon = plane.polygon
    polygon.rewind()
    var min = Float.POSITIVE_INFINITY
    var max = Float.NEGATIVE_INFINITY
    val local = FloatArray(3)
    while (polygon.remaining() >= 2) {
      local[0] = polygon.get()
      local[1] = 0f
      local[2] = polygon.get()
      val world = pose.transformPoint(local)
      val t = (world[0] - pose.tx()) * dirX + (world[2] - pose.tz()) * dirZ
      if (t < min) min = t
      if (t > max) max = t
    }
    if (!(max - min >= MIN_WALL_LENGTH_M)) return null
    return CollisionMath.Segment(
      pose.tx() + dirX * min, pose.tz() + dirZ * min,
      pose.tx() + dirX * max, pose.tz() + dirZ * max,
    )
  }

  /**
   * Anchor on a floor or wall plane at (x, y, z), world-aligned (translation only), so the
   * pivot's yaw is a world yaw. Attached to the plane, ARCore moves it when it refines the
   * plane; a free-floating anchor would leave the furniture floating or sunk (or the art
   * off the wall).
   */
  private fun createAnchorOn(session: Session, plane: Trackable?, x: Float, y: Float, z: Float): Anchor {
    val pose = Pose.makeTranslation(x, y, z)
    return plane?.takeIf { it.trackingState == TrackingState.TRACKING }
      ?.let { runCatching { it.createAnchor(pose) }.getOrNull() }
      ?: session.createAnchor(pose)
  }

  /** Floor hit under a screen point: an upward plane near the lowest one, inside its polygon. */
  private fun floorHitAt(xPx: Float, yPx: Float): HitResult? {
    val view = sceneView ?: return null
    return view.hitTestAR(
      xPx = xPx,
      yPx = yPx,
      planeTypes = setOf(Plane.Type.HORIZONTAL_UPWARD_FACING),
      planePoseInPolygon = true,
      predicate = { hit ->
        val y = floorY
        y == null || hit.hitPose.ty() <= y + FLOOR_TOLERANCE_M
      },
    )
  }

  /** The floor plane (tracked, near the lowest one) whose detected polygon contains (x, z). */
  private fun floorPlaneAt(x: Float, z: Float): Plane? {
    val session = sceneView?.session ?: return null
    val floor = floorY ?: return null
    return session.getAllTrackables(Plane::class.java).firstOrNull { plane ->
      plane.trackingState == TrackingState.TRACKING &&
        plane.subsumedBy == null &&
        plane.type == Plane.Type.HORIZONTAL_UPWARD_FACING &&
        plane.centerPose.ty() <= floor + FLOOR_TOLERANCE_M &&
        plane.isPoseInPolygon(Pose.makeTranslation(x, plane.centerPose.ty(), z))
    }
  }

  /** Wall hit under a screen point: a vertical plane, inside its detected polygon. */
  private fun wallHitAt(xPx: Float, yPx: Float): HitResult? {
    val view = sceneView ?: return null
    return view.hitTestAR(
      xPx = xPx,
      yPx = yPx,
      planeTypes = setOf(Plane.Type.VERTICAL),
      planePoseInPolygon = true,
    )
  }

  /** Nearest Depth API or feature-point hit under a screen point (any surface, no planes). */
  private fun surfaceHitAt(xPx: Float, yPx: Float): HitResult? {
    val view = sceneView ?: return null
    return view.hitTestAR(
      xPx = xPx,
      yPx = yPx,
      planeTypes = emptySet(),
      point = true,
      depthPoint = true,
      planePoseInPolygon = false,
    )
  }

  /** Where a wall item goes: its back-center position, its yaw and what to anchor it to. */
  private class WallSpot(val position: Position, val yawRadians: Float, val trackable: Trackable)

  /**
   * The wall under a screen point. A detected vertical plane if there is one. Otherwise, for
   * plain walls ARCore never turns into planes, the surface measured with the Depth API and
   * feature points: a 3x3 grid of hits around the point, fitted as a vertical wall
   * ([ArMath.wallYawFromPoints]); the spot is moved onto the fitted surface so depth noise
   * does not leave the item floating or sunk.
   */
  private fun wallSpotAt(xPx: Float, yPx: Float, camera: ArMath.Vec3): WallSpot? {
    wallHitAt(xPx, yPx)?.let { hit ->
      val hp = hit.hitPose
      val normal = hp.yAxis // a plane hit's local +Y is the plane normal
      val yaw = ArMath.yawOutOfWall(ArMath.Vec3(normal[0], normal[1], normal[2]), ArMath.Vec3(hp.tx(), hp.ty(), hp.tz()), camera)
      if (yaw != null) return WallSpot(Position(hp.tx(), hp.ty(), hp.tz()), yaw, hit.trackable)
    }

    val view = sceneView ?: return null
    val center = surfaceHitAt(xPx, yPx) ?: return null
    val step = WALL_SAMPLE_SPREAD * minOf(view.width, view.height)
    val points = listOf(-1, 0, 1).flatMap { i ->
      listOf(-1, 0, 1).mapNotNull { j ->
        surfaceHitAt(xPx + i * step, yPx + j * step)?.hitPose?.let { ArMath.Vec3(it.tx(), it.ty(), it.tz()) }
      }
    }
    val yaw = ArMath.wallYawFromPoints(points, camera) ?: return null
    val c = center.hitPose
    val n = ArMath.forward(yaw)
    // Median distance of the samples from the center hit, along the wall normal.
    val offsets = points.map { (it.x - c.tx()) * n.x + (it.z - c.tz()) * n.z }.sorted()
    val shift = offsets[offsets.size / 2]
    return WallSpot(Position(c.tx() + n.x * shift, c.ty(), c.tz() + n.z * shift), yaw, center.trackable)
  }

  /** Whether a wall item centered at [centerY] keeps its bottom edge above the floor. */
  private fun isAboveFloor(centerY: Float, height: Float): Boolean {
    val floor = floorY ?: return true // floor not seen yet: nothing to go through
    return centerY - height / 2f >= floor - FLOOR_CONTACT_SLACK_M
  }

  // ---------------------------------------------------------------------------------------
  // Wall items: keep them flush with the real wall
  // ---------------------------------------------------------------------------------------

  private var lastWallRefineNs = 0L

  /**
   * Re-measures the wall behind each hung item a few times a second and eases the item onto
   * it (angle and distance). The measurement at placement spans only a small patch around the
   * aimed point, so it can be a few degrees off, which shows as an edge floating off (or
   * sinking into) the wall when seen from the side. Here the samples span the item's whole
   * back face (a long baseline), and ARCore's depth and planes improve as the user moves.
   * Smoothed, with a dead-band, so the item does not jitter; implausible jumps are ignored.
   */
  private fun refineWallItems(frame: Frame) {
    if (frame.timestamp - lastWallRefineNs < WALL_REFINE_INTERVAL_NS) return
    lastWallRefineNs = frame.timestamp
    val camera = frame.camera
    if (camera.trackingState != TrackingState.TRACKING) return
    val wallItems = items.values.filter { it.isWallMounted && !it.isLoading && it !== dragging }
    if (wallItems.isEmpty()) return
    val viewMatrix = FloatArray(16).also { camera.getViewMatrix(it, 0) }
    val projection = FloatArray(16).also { camera.getProjectionMatrix(it, 0, NEAR_M, FAR_M) }
    val cameraPose = camera.pose
    val viewer = ArMath.Vec3(cameraPose.tx(), cameraPose.ty(), cameraPose.tz())
    wallItems.forEach { refineWallItem(it, viewMatrix, projection, viewer) }
  }

  private fun refineWallItem(item: PlacedItem, viewMatrix: FloatArray, projection: FloatArray, viewer: ArMath.Vec3) {
    val view = sceneView ?: return
    val p = item.pivot.worldPosition
    val back = ArMath.Vec3(p.x, p.y, p.z)
    val forward = ArMath.forward(item.yawRadians)
    val right = ArMath.Vec3(cos(item.yawRadians), 0f, -sin(item.yawRadians)) // local +X
    fun screenOf(point: ArMath.Vec3): Pair<Float, Float>? =
      ArMath.project(point, view.width, view.height, viewMatrix, projection)
        ?.takeIf { (x, y) -> x in 0f..view.width.toFloat() && y in 0f..view.height.toFloat() }
    // Distance of a measured point in front of (+) or behind (-) the item's current back.
    fun offsetOf(q: ArMath.Vec3) = ArMath.dot(q - back, forward)

    val center = screenOf(back) ?: return // not in view: nothing to measure

    // A detected wall plane right behind the item is the most accurate source.
    var yaw: Float? = null
    var offset: Float? = null
    wallHitAt(center.first, center.second)?.hitPose?.let { hp ->
      val q = ArMath.Vec3(hp.tx(), hp.ty(), hp.tz())
      val normal = hp.yAxis
      if (abs(offsetOf(q)) <= WALL_REFINE_MAX_OFFSET_M) {
        yaw = ArMath.yawOutOfWall(ArMath.Vec3(normal[0], normal[1], normal[2]), q, viewer)
        offset = offsetOf(q)
      }
    }

    // Otherwise depth / feature-point samples spread over the item's back face. The virtual
    // item doesn't hide the real wall from ARCore's depth.
    if (yaw == null) {
      val points = mutableListOf<ArMath.Vec3>()
      for (u in WALL_REFINE_U) {
        for (v in WALL_REFINE_V) {
          val target = back + right * (u * item.width / 2f) + ArMath.Vec3(0f, v * item.height / 2f, 0f)
          val (x, y) = screenOf(target) ?: continue
          val hp = surfaceHitAt(x, y)?.hitPose ?: continue
          val q = ArMath.Vec3(hp.tx(), hp.ty(), hp.tz())
          // Only the item's wall: not a sofa in front of it, not a room behind a doorway.
          if (abs(offsetOf(q)) <= WALL_REFINE_MAX_OFFSET_M) points += q
        }
      }
      yaw = ArMath.wallYawFromPoints(points, viewer) ?: return
      val n = ArMath.forward(yaw!!)
      val offsets = points.map { ArMath.dot(it - back, n) }.sorted()
      offset = offsets[offsets.size / 2]
    }

    val targetYaw = yaw ?: return
    val shiftTo = offset ?: return
    val turnBy = ArMath.angleDelta(item.yawRadians, targetYaw)
    if (abs(turnBy) > WALL_REFINE_MAX_TURN_RAD || abs(shiftTo) > WALL_REFINE_MAX_OFFSET_M) return // a bad sample
    val turn = if (abs(turnBy) < WALL_REFINE_DEADBAND_RAD) 0f else turnBy * WALL_REFINE_GAIN
    val shift = if (abs(shiftTo) < WALL_REFINE_DEADBAND_M) 0f else shiftTo * WALL_REFINE_GAIN
    if (turn == 0f && shift == 0f) return
    val n = ArMath.forward(targetYaw)
    applyYaw(item, item.yawRadians + turn)
    item.pivot.worldPosition = Position(p.x + n.x * shift, p.y, p.z + n.z * shift)
  }

  // ---------------------------------------------------------------------------------------
  // Imperative methods (called from JS through the ref)
  // ---------------------------------------------------------------------------------------

  fun placeItem(record: ARItemRecord, promise: Promise) {
    val view = sceneView
    val session = view?.session
    val frame = view?.frame
    if (view == null || session == null || frame == null || frame.camera.trackingState != TrackingState.TRACKING) {
      promise.reject("NOT_READY", "AR is not tracking yet. Move your phone slowly around the room.", null)
      return
    }
    if (items.containsKey(record.instanceId)) {
      promise.reject("DUPLICATE_INSTANCE", "Item ${record.instanceId} is already placed.", null)
      return
    }
    val dims = record.dimensions
    val requested = record.pose
    val poseValid = requested == null || listOf(requested.x, requested.y, requested.z, requested.yaw).all { it.isFinite() }
    if (record.instanceId.isBlank() || record.glbUrl.isBlank() || dims.width <= 0 || dims.depth <= 0 || dims.height <= 0 || !poseValid) {
      promise.reject("INVALID_ITEM", "Item needs an instanceId, a glbUrl and positive dimensions.", null)
      return
    }
    // Restoring on a cloud anchor found with resolveCloudAnchor: the item takes it over.
    val cloudId = record.cloudAnchorId
    val cloud: Anchor? = if (cloudId != null) {
      resolvedAnchors.remove(cloudId) ?: run {
        promise.reject("CLOUD_ANCHOR_NOT_FOUND", "That cloud anchor has not been found in this session.", null)
        return
      }
    } else {
      null
    }
    val cloudPose = cloud?.pose
    val restorePosition = cloudPose?.let { ArMath.Vec3(it.tx(), it.ty(), it.tz()) }
      ?: requested?.let { ArMath.Vec3(it.x.toFloat(), it.y.toFloat(), it.z.toFloat()) }
    val restoreYaw = cloudPose?.let { atan2(it.zAxis[0], it.zAxis[2]) } ?: requested?.yaw?.toFloat()
    val isRestore = restorePosition != null && restoreYaw != null

    val isWall = record.category == WALL_ART_CATEGORY
    val cameraPose = frame.camera.pose
    val camera = ArMath.Vec3(cameraPose.tx(), cameraPose.ty(), cameraPose.tz())
    val centerX = view.width / 2f
    val centerY = view.height / 2f

    // Floor items: on the floor, facing the camera. Wall items: centered on the wall spot,
    // back flat on the wall, facing out of it toward the room. Restoring (a cloud anchor or an
    // explicit pose): there; floor items at the height of the floor plane under it if one is
    // detected (settleFloorItems refines it), wall items snapped onto the detected wall they
    // belong to, if any (refineWallItems does the rest).
    val position: Position
    val yaw: Float
    val host: Trackable?
    if (restorePosition != null && restoreYaw != null) {
      val snap = if (isWall) ArMath.snapToWall(restorePosition.x, restorePosition.z, restoreYaw, walls.map { it.segment }) else null
      val x = snap?.x ?: restorePosition.x
      val z = snap?.z ?: restorePosition.z
      yaw = snap?.yawRadians ?: restoreYaw
      val floorPlane = if (isWall) null else floorPlaneAt(x, z)
      host = floorPlane
      // Floor items stand on today's floor, not at the saved height: ARCore's floor estimate
      // drifts a few cm between placements and sessions, which would sink or lift them. A cloud
      // anchor's own height is a measurement of the floor, better than the lowest plane.
      val y = when {
        isWall -> restorePosition.y
        floorPlane != null -> floorPlane.centerPose.ty()
        cloud != null -> restorePosition.y
        else -> floorY ?: restorePosition.y
      }
      position = Position(x, y, z)
      if (isWall && !isAboveFloor(position.y, dims.height.toFloat())) {
        runCatching { cloud?.detach() }
        onPlacementBlocked(mapOf("instanceId" to record.instanceId, "reason" to "noWall"))
        promise.reject("PLACEMENT_BLOCKED", "It would go into the floor.", null)
        return
      }
    } else if (isWall) {
      val spot = wallSpotAt(centerX, centerY, camera)
      if (spot == null) {
        onPlacementBlocked(mapOf("instanceId" to record.instanceId, "reason" to "noWall"))
        promise.reject("NO_WALL", "Point the center of the screen at a wall.", null)
        return
      }
      if (!isAboveFloor(spot.position.y, dims.height.toFloat())) {
        onPlacementBlocked(mapOf("instanceId" to record.instanceId, "reason" to "noWall"))
        promise.reject("PLACEMENT_BLOCKED", "Aim higher: it would go into the floor.", null)
        return
      }
      position = spot.position
      yaw = spot.yawRadians
      host = spot.trackable
    } else {
      val floorHit = floorHitAt(centerX, centerY)
      if (floorHit == null) {
        onPlacementBlocked(mapOf("instanceId" to record.instanceId, "reason" to "noFloor"))
        promise.reject("NO_FLOOR", "Point the center of the screen at the floor.", null)
        return
      }
      val hp = floorHit.hitPose
      position = Position(hp.tx(), hp.ty(), hp.tz())
      yaw = ArMath.yawFacing(from = ArMath.Vec3(hp.tx(), hp.ty(), hp.tz()), target = camera)
      host = floorHit.trackable
    }

    // Never create a collision by placing: refuse spots across a wall or on another item.
    // Restored items are exempt (CLAUDE.md 4.4 rule 13): the saved arrangement was valid, and
    // today's anchor/wall/floor estimates are each a few cm off, so a chair saved against a wall
    // or a painting on it would otherwise go missing. The escape rule lets the user move them.
    if (!isRestore) {
      val footprint = footprintAt(isWall, position, yaw, dims.width.toFloat(), dims.depth.toFloat(), dims.height.toFloat())
      val blockedBy = CollisionMath.blockedReason(
        moving = CollisionMath.Body(record.instanceId, footprint, record.category == FLOOR_COVERING_CATEGORY, isWall),
        candidate = footprint,
        current = null,
        others = items.values.map(::bodyOf),
        walls = walls,
      )
      if (blockedBy != null) {
        onPlacementBlocked(mapOf("instanceId" to record.instanceId, "reason" to blockedBy.jsName))
        val surface = if (isWall) "wall" else "floor"
        promise.reject("PLACEMENT_BLOCKED", "That spot is taken. Aim at a free area of the $surface.", null)
        return
      }
    }

    val anchor = createAnchorOn(session, host, position.x, position.y, position.z)

    val item = createItem(record, AnchorNode(view.engine, anchor), yaw, isWall)
    item.hostPlane = host
    item.cloudAnchor = cloud
    item.cloudAnchorId = if (cloud != null) cloudId else null
    items[item.instanceId] = item
    // Footprint shows where the model will appear while it downloads (not when rebuilding a
    // scene: the item the user aimed stays selected).
    if (!isRestore) select(item)

    scope.launch {
      try {
        val file = modelCache.get(record.glbUrl)
        val buffer = withContext(Dispatchers.IO) { readDirectBuffer(file) }
        if (items[item.instanceId] !== item || destroyed) {
          promise.reject("CANCELLED", "The item was removed before its model finished loading.", null)
          return@launch
        }
        attachModel(item, buffer)
        onItemPlaced(mapOf("instanceId" to item.instanceId, "productId" to item.productId))
        promise.resolve(null)
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        Log.w(TAG, "Model load failed: ${record.glbUrl}", e)
        if (items[item.instanceId] === item) removeItemInternal(item)
        val message = "Could not load the 3D model. Check your connection and try again."
        emitError("MODEL_LOAD_FAILED", message)
        promise.reject("MODEL_LOAD_FAILED", message, e)
      }
    }
  }

  fun removeItem(instanceId: String, promise: Promise) {
    items[instanceId]?.let { removeItemInternal(it) }
    promise.resolve(null)
  }

  fun clearScene(promise: Promise) {
    items.values.toList().forEach { removeItemInternal(it) }
    releaseUnclaimedAnchors()
    promise.resolve(null)
  }

  fun captureSnapshot(promise: Promise) {
    val view = sceneView
    if (view == null || view.width == 0 || view.height == 0) {
      promise.reject("NOT_READY", "AR view is not ready.", null)
      return
    }
    // Hide selection footprints and controls so the photo shows only the room and the furniture.
    items.values.forEach { it.footprint.isVisible = false }
    controlsHidden = true
    updateControls()
    // Wait for a couple of frames without the overlay before copying the surface.
    view.postDelayed({
      val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
      PixelCopy.request(view, bitmap, { result ->
        restoreFootprints()
        controlsHidden = false
        updateControls()
        if (result != PixelCopy.SUCCESS) {
          promise.reject("SNAPSHOT_FAILED", "Could not capture the AR view (code $result).", null)
          return@request
        }
        scope.launch {
          try {
            val file = withContext(Dispatchers.IO) { saveJpeg(bitmap) }
            promise.resolve(mapOf("uri" to "file://${file.absolutePath}"))
          } catch (e: Exception) {
            promise.reject("SNAPSHOT_FAILED", "Could not save the snapshot.", e)
          } finally {
            bitmap.recycle()
          }
        }
      }, mainHandler)
    }, SNAPSHOT_DELAY_MS)
  }

  fun getPlacedItems(promise: Promise) {
    promise.resolve(
      items.values.filter { !it.isLoading }.map { item ->
        val p = item.pivot.worldPosition
        buildMap {
          put("instanceId", item.instanceId)
          put("productId", item.productId)
          put(
            "pose",
            mapOf("x" to p.x.toDouble(), "y" to p.y.toDouble(), "z" to p.z.toDouble(), "yaw" to item.yawRadians.toDouble()),
          )
          item.cloudAnchorId?.let { put("cloudAnchorId", it) }
        }
      },
    )
  }

  // ---------------------------------------------------------------------------------------
  // Cloud anchors: a saved scene's spot in the room
  // ---------------------------------------------------------------------------------------

  /** Host requests waiting until their item has been seen well enough (see checkPendingHosts). */
  private class PendingHost(val item: PlacedItem, val promise: Promise, val deadlineNs: Long) {
    var lastQuality: Session.FeatureMapQuality? = null
  }
  private val pendingHosts = mutableListOf<PendingHost>()

  /** Uploads in progress. */
  private val hostTasks = HashMap<HostCloudAnchorFuture, Promise>()

  /** Anchors being looked for, by cloud anchor id. */
  private val resolveTasks = HashMap<String, Pair<ResolveCloudAnchorFuture, Promise>>()

  /** Found anchors whose pose is settling before they are reported (see settleResolvedAnchors). */
  private class SettlingAnchor(val anchor: Anchor, val promise: Promise, val foundNs: Long) {
    var trackedSinceNs: Long? = null
  }
  private val settlingAnchors = HashMap<String, SettlingAnchor>()

  /** Found anchors reported to JS, waiting for `placeItem({ cloudAnchorId })` to take them. */
  private val resolvedAnchors = HashMap<String, Anchor>()

  /**
   * Hosting needs the spot seen from a few angles. Each request waits until its item has been
   * in view while ARCore rates what it sees good enough (`estimateFeatureMapQualityForHosting`
   * not INSUFFICIENT, checked every frame, like Google's Cloud Anchors sample), then uploads an
   * anchor at the item's pose. After [CLOUD_ANCHOR_MAPPING_TIMEOUT_MS] it uploads anyway and
   * lets the server decide (on device the estimate sometimes stayed INSUFFICIENT in a normal,
   * lit room); a real shortage then fails as `CLOUD_ANCHOR_LOW_QUALITY`.
   */
  fun hostItemAnchor(instanceId: String, promise: Promise) {
    if (sceneView?.session == null) {
      Log.w(TAG, "hostItemAnchor($instanceId): no AR session")
      promise.reject("NOT_READY", "AR is not running yet.", null)
      return
    }
    val item = items[instanceId]
    if (item == null || item.isLoading) {
      Log.w(TAG, "hostItemAnchor($instanceId): no such placed item (loading: ${item?.isLoading})")
      promise.reject("INVALID_ITEM", "No placed item $instanceId.", null)
      return
    }
    pendingHosts.filter { it.item === item }.forEach {
      pendingHosts.remove(it)
      it.promise.reject("CANCELLED", "A newer request replaced this one.", null)
    }
    pendingHosts += PendingHost(item, promise, SystemClock.elapsedRealtimeNanos() + CLOUD_ANCHOR_MAPPING_TIMEOUT_MS * 1_000_000)
    Log.i(TAG, "Waiting to host a cloud anchor for ${item.productId} (${pendingHosts.size} waiting)")
  }

  private fun checkPendingHosts(session: Session, frame: Frame) {
    if (pendingHosts.isEmpty()) return
    val view = sceneView ?: return
    val now = SystemClock.elapsedRealtimeNanos()
    val camera = frame.camera
    val tracking = camera.trackingState == TrackingState.TRACKING
    val viewMatrix = FloatArray(16)
    val projection = FloatArray(16)
    if (tracking) {
      camera.getViewMatrix(viewMatrix, 0)
      camera.getProjectionMatrix(projection, 0, NEAR_M, FAR_M)
    }
    val cameraPose = camera.pose
    val viewer = ArMath.Vec3(cameraPose.tx(), cameraPose.ty(), cameraPose.tz())
    // One estimate per frame, shared by the items in view (it rates what the camera sees).
    val quality by lazy { runCatching { session.estimateFeatureMapQualityForHosting(cameraPose) }.getOrNull() }
    for (request in pendingHosts.toList()) {
      val item = request.item
      if (items[item.instanceId] !== item) {
        pendingHosts.remove(request)
        Log.w(TAG, "Hosting for ${item.productId} cancelled: the item was removed")
        request.promise.reject("CANCELLED", "The item was removed.", null)
        continue
      }
      if (tracking && isInView(item, viewer, viewMatrix, projection, view.width, view.height)) {
        if (quality != request.lastQuality) {
          Log.i(TAG, "Mapping quality around ${item.productId}: $quality")
          request.lastQuality = quality
        }
        if (quality != null && quality != Session.FeatureMapQuality.INSUFFICIENT) {
          pendingHosts.remove(request)
          startHosting(session, item, request.promise)
          continue
        }
      }
      if (now > request.deadlineNs) {
        pendingHosts.remove(request)
        Log.i(TAG, "Mapping around ${item.productId} still ${request.lastQuality} after the wait; hosting anyway")
        startHosting(session, item, request.promise)
      }
    }
  }

  /** Whether an item is on screen and close enough for what the camera sees to count for it. */
  private fun isInView(item: PlacedItem, viewer: ArMath.Vec3, viewMatrix: FloatArray, projection: FloatArray, width: Int, height: Int): Boolean {
    val p = item.pivot.worldPosition
    val center = if (item.isWallMounted) ArMath.Vec3(p.x, p.y, p.z) else ArMath.Vec3(p.x, p.y + item.height / 2f, p.z)
    val d = center - viewer
    if (ArMath.dot(d, d) > CLOUD_ANCHOR_VIEW_DISTANCE_M * CLOUD_ANCHOR_VIEW_DISTANCE_M) return false
    val (x, y) = ArMath.project(center, width, height, viewMatrix, projection) ?: return false
    return x in 0f..width.toFloat() && y in 0f..height.toFloat()
  }

  private fun startHosting(session: Session, item: PlacedItem, promise: Promise) {
    val p = item.pivot.worldPosition
    val half = item.yawRadians / 2f // rotation around +Y only: (x, y, z, w)
    val movesAtStart = item.userMoves
    val anchor = session.createAnchor(Pose(floatArrayOf(p.x, p.y, p.z), floatArrayOf(0f, sin(half), 0f, cos(half))))
    lateinit var future: HostCloudAnchorFuture
    future = session.hostCloudAnchorAsync(anchor, CLOUD_ANCHOR_TTL_DAYS) { cloudAnchorId, state ->
      mainHandler.post {
        runCatching { anchor.detach() }
        if (hostTasks.remove(future) == null) return@post // cancelled
        Log.i(TAG, "Hosting cloud anchor for ${item.productId} finished: $state")
        if (state == Anchor.CloudAnchorState.SUCCESS && cloudAnchorId != null) {
          // The anchor marks the item's spot, unless the user has moved it meanwhile.
          if (items[item.instanceId] === item && item.userMoves == movesAtStart) item.cloudAnchorId = cloudAnchorId
          promise.resolve(mapOf("cloudAnchorId" to cloudAnchorId, "ttlDays" to CLOUD_ANCHOR_TTL_DAYS))
        } else {
          val (code, message) = cloudAnchorError(state)
          promise.reject(code, message, null)
        }
      }
    }
    hostTasks[future] = promise
  }

  fun resolveCloudAnchor(cloudAnchorId: String, promise: Promise) {
    val session = sceneView?.session
    if (session == null) {
      promise.reject("NOT_READY", "AR is not running yet.", null)
      return
    }
    resolvedAnchors[cloudAnchorId]?.let {
      promise.resolve(poseMapOf(it.pose))
      return
    }
    resolveTasks.remove(cloudAnchorId)?.let { (future, previous) ->
      future.cancel()
      previous.reject("CANCELLED", "A newer request replaced this one.", null)
    }
    settlingAnchors.remove(cloudAnchorId)?.let {
      runCatching { it.anchor.detach() }
      it.promise.reject("CANCELLED", "A newer request replaced this one.", null)
    }
    lateinit var future: ResolveCloudAnchorFuture
    future = session.resolveCloudAnchorAsync(cloudAnchorId) { anchor, state ->
      mainHandler.post {
        if (resolveTasks[cloudAnchorId]?.first !== future) {
          runCatching { anchor?.detach() }
          return@post
        }
        resolveTasks.remove(cloudAnchorId)
        if (state == Anchor.CloudAnchorState.SUCCESS && anchor != null) {
          Log.i(TAG, "Cloud anchor $cloudAnchorId found; letting it settle")
          settlingAnchors[cloudAnchorId] = SettlingAnchor(anchor, promise, SystemClock.elapsedRealtimeNanos())
        } else {
          val (code, message) = cloudAnchorError(state)
          Log.w(TAG, "Resolving cloud anchor $cloudAnchorId failed: $state")
          promise.reject(code, message, null)
        }
      }
    }
    resolveTasks[cloudAnchorId] = future to promise
  }

  /**
   * ARCore keeps refining a cloud anchor for a moment after recognizing it, and the first pose
   * is the roughest. A found anchor is reported once it has been tracked for
   * [CLOUD_ANCHOR_SETTLE_MS] (at most [CLOUD_ANCHOR_SETTLE_MAX_MS] after it was found).
   */
  private fun settleResolvedAnchors() {
    if (settlingAnchors.isEmpty()) return
    val now = SystemClock.elapsedRealtimeNanos()
    for ((id, settling) in settlingAnchors.toList()) {
      when (settling.anchor.trackingState) {
        TrackingState.STOPPED -> {
          settlingAnchors.remove(id)
          settling.promise.reject("CLOUD_ANCHOR_FAILED", "Lost the scene's spot again.", null)
          continue
        }
        TrackingState.TRACKING -> if (settling.trackedSinceNs == null) settling.trackedSinceNs = now
        else -> settling.trackedSinceNs = null
      }
      val trackedSince = settling.trackedSinceNs
      val settled = trackedSince != null && now - trackedSince >= CLOUD_ANCHOR_SETTLE_MS * 1_000_000
      if (settled || now - settling.foundNs >= CLOUD_ANCHOR_SETTLE_MAX_MS * 1_000_000) {
        settlingAnchors.remove(id)
        resolvedAnchors[id] = settling.anchor
        Log.i(TAG, "Cloud anchor $id settled")
        settling.promise.resolve(poseMapOf(settling.anchor.pose))
      }
    }
  }

  fun stopResolvingCloudAnchors(promise: Promise) {
    stopResolving()
    promise.resolve(null)
  }

  private fun stopResolving() {
    val tasks = resolveTasks.values.toList()
    resolveTasks.clear()
    tasks.forEach { (future, promise) ->
      future.cancel()
      promise.reject("CANCELLED", "Stopped looking for the scene's spot.", null)
    }
    val settling = settlingAnchors.values.toList()
    settlingAnchors.clear()
    settling.forEach {
      runCatching { it.anchor.detach() }
      it.promise.reject("CANCELLED", "Stopped looking for the scene's spot.", null)
    }
  }

  /** Found anchors no item took (e.g. the scene was cleared meanwhile). */
  private fun releaseUnclaimedAnchors() {
    resolvedAnchors.values.forEach { runCatching { it.detach() } }
    resolvedAnchors.clear()
  }

  private fun cancelCloudAnchorTasks() {
    stopResolving()
    releaseUnclaimedAnchors()
    cancelHosts("The AR view was closed.")
  }

  private fun cancelHosts(reason: String) {
    val pending = pendingHosts.toList()
    pendingHosts.clear()
    pending.forEach { it.promise.reject("CANCELLED", reason, null) }
    val uploads = hostTasks.toList()
    hostTasks.clear()
    uploads.forEach { (future, promise) ->
      future.cancel()
      promise.reject("CANCELLED", reason, null)
    }
  }

  /** Position and yaw (from the local +Z axis) of an anchor pose, for JS. */
  private fun poseMapOf(pose: Pose): Map<String, Double> {
    val front = pose.zAxis
    return mapOf(
      "x" to pose.tx().toDouble(),
      "y" to pose.ty().toDouble(),
      "z" to pose.tz().toDouble(),
      "yaw" to atan2(front[0], front[2]).toDouble(),
    )
  }

  /**
   * Restored items stay on their cloud anchor while ARCore refines it: every frame they are
   * eased toward its current pose ([ArMath.followStep]; floor items in X/Z and yaw, their height
   * is the floor's; wall items only along their wall). Until the user moves them.
   */
  private fun followCloudAnchors() {
    for (item in items.values) {
      val anchor = item.cloudAnchor ?: continue
      if (anchor.trackingState != TrackingState.TRACKING || item === dragging || pressedHandle?.first === item) continue
      val pose = anchor.pose
      val p = item.pivot.worldPosition
      val step = ArMath.followStep(
        ArMath.Vec3(p.x, p.y, p.z), ArMath.Vec3(pose.tx(), pose.ty(), pose.tz()),
        item.yawRadians, item.isWallMounted, CLOUD_FOLLOW_GAIN, CLOUD_FOLLOW_DEADBAND_M,
      )
      if (step.x != 0f || step.y != 0f || step.z != 0f) item.pivot.worldPosition = Position(p.x + step.x, p.y + step.y, p.z + step.z)
      if (!item.isWallMounted) {
        val front = pose.zAxis
        val turn = ArMath.angleDelta(item.yawRadians, atan2(front[0], front[2]))
        if (abs(turn) >= CLOUD_FOLLOW_DEADBAND_RAD) applyYaw(item, item.yawRadians + turn * CLOUD_FOLLOW_GAIN)
      }
    }
  }

  /** The user moved [item] (drag, arrows, twist): it no longer follows nor marks its cloud anchor. */
  private fun userMoved(item: PlacedItem) {
    item.userMoves++
    item.cloudAnchorId = null
    item.cloudAnchor?.let { runCatching { it.detach() } }
    item.cloudAnchor = null
  }

  // ---------------------------------------------------------------------------------------
  // Floor items: keep them standing on the floor
  // ---------------------------------------------------------------------------------------

  private var lastFloorSettleNs = 0L

  /**
   * Keeps floor items standing on the floor: about 5 times a second the floor under each one is
   * measured, from the detected floor plane under its center or else from depth /
   * feature-point hits spread under its footprint ([ArMath.floorFromSamples]), and the item is
   * eased onto it (smoothed, 3 mm dead-band, offsets over 15 cm ignored as a bad sample or a
   * table). Restored items start at the saved height and ARCore's floor estimate keeps
   * improving after placement; without this they float or sink by a few cm. Once settled over
   * a detected floor plane, an item is anchored on it so ARCore keeps it there.
   */
  private fun settleFloorItems(frame: Frame) {
    if (frame.timestamp - lastFloorSettleNs < FLOOR_SETTLE_INTERVAL_NS) return
    lastFloorSettleNs = frame.timestamp
    val camera = frame.camera
    if (camera.trackingState != TrackingState.TRACKING) return
    val floorItems = items.values.filter { !it.isWallMounted && it !== dragging && pressedHandle?.first !== it }
    if (floorItems.isEmpty()) return
    val viewMatrix = FloatArray(16).also { camera.getViewMatrix(it, 0) }
    val projection = FloatArray(16).also { camera.getProjectionMatrix(it, 0, NEAR_M, FAR_M) }
    floorItems.forEach { settleFloorItem(it, viewMatrix, projection) }
  }

  private fun settleFloorItem(item: PlacedItem, viewMatrix: FloatArray, projection: FloatArray) {
    val p = item.pivot.worldPosition
    val plane = floorPlaneAt(p.x, p.z)
    val floor = plane?.centerPose?.ty() ?: floorFromDepth(item, p, viewMatrix, projection) ?: return
    val offset = floor - p.y
    if (abs(offset) > FLOOR_SETTLE_MAX_OFFSET_M) return
    if (abs(offset) >= FLOOR_SETTLE_DEADBAND_M) {
      item.pivot.worldPosition = Position(p.x, p.y + offset * FLOOR_SETTLE_GAIN, p.z)
    } else if (plane != null && item.hostPlane !is Plane && item.cloudAnchor == null) {
      reanchor(item, plane)
    }
  }

  /** Floor height under an item from depth / feature-point hits over its footprint, or null. */
  private fun floorFromDepth(item: PlacedItem, p: Position, viewMatrix: FloatArray, projection: FloatArray): Float? {
    val view = sceneView ?: return null
    val expected = mutableListOf<ArMath.Vec3>()
    val hits = mutableListOf<ArMath.Vec3?>()
    for (u in FLOOR_SAMPLE_FRACTIONS) {
      for (v in FLOOR_SAMPLE_FRACTIONS) {
        val offset = ArMath.toWorld(ArMath.Vec3(u * item.width / 2f, 0f, v * item.depth / 2f), item.yawRadians)
        val target = ArMath.Vec3(p.x + offset.x, p.y, p.z + offset.z)
        val (x, y) = ArMath.project(target, view.width, view.height, viewMatrix, projection)
          ?.takeIf { (x, y) -> x in 0f..view.width.toFloat() && y in 0f..view.height.toFloat() }
          ?: continue
        expected += target
        hits += surfaceHitAt(x, y)?.hitPose?.let { ArMath.Vec3(it.tx(), it.ty(), it.tz()) }
      }
    }
    return ArMath.floorFromSamples(expected, hits, FLOOR_SAMPLE_MAX_HORIZONTAL_M, FLOOR_SETTLE_MAX_OFFSET_M, FLOOR_SAMPLE_MIN_COUNT)
  }

  private fun cloudAnchorError(state: Anchor.CloudAnchorState): Pair<String, String> = when (state) {
    Anchor.CloudAnchorState.ERROR_NOT_AUTHORIZED ->
      "CLOUD_ANCHOR_NOT_AUTHORIZED" to "This app is not set up for ARCore Cloud Anchors yet."
    Anchor.CloudAnchorState.ERROR_HOSTING_DATASET_PROCESSING_FAILED ->
      "CLOUD_ANCHOR_LOW_QUALITY" to "Not enough of the room was seen. Walk around the furniture while pointing at it, then save again."
    Anchor.CloudAnchorState.ERROR_CLOUD_ID_NOT_FOUND ->
      "CLOUD_ANCHOR_NOT_FOUND" to "This scene's spot in the room has expired."
    else -> "CLOUD_ANCHOR_FAILED" to "Could not reach ARCore Cloud Anchors (${state.name})."
  }

  // ---------------------------------------------------------------------------------------
  // Items
  // ---------------------------------------------------------------------------------------

  private fun createItem(record: ARItemRecord, anchorNode: AnchorNode, yaw: Float, isWall: Boolean): PlacedItem {
    val view = sceneView!!
    val width = record.dimensions.width.toFloat()
    val depth = record.dimensions.depth.toFloat()
    val height = record.dimensions.height.toFloat()

    val pivot = Node(view.engine).apply { isHittable = false }
    // Floor: the footprint itself, flat on the floor. Wall: a thin panel on the wall, a bit
    // larger than the item, so the highlight shows as a border around it.
    val footprint = CubeNode(
      engine = view.engine,
      size = if (isWall) {
        Size(width + 2 * WALL_HALO_M, height + 2 * WALL_HALO_M, FOOTPRINT_THICKNESS_M)
      } else {
        Size(width, FOOTPRINT_THICKNESS_M, depth)
      },
      center = if (isWall) Position(0f, 0f, FOOTPRINT_THICKNESS_M / 2f) else Position(0f, FOOTPRINT_THICKNESS_M / 2f, 0f),
      materialInstance = footprintSelected,
    ).apply {
      isVisible = false
      isHittable = false
      isShadowCaster = false
      isShadowReceiver = false
    }
    pivot.addChildNode(footprint)

    // Soft shadow, shown once the model is in (see attachModel): grounding on the floor, or
    // a drop shadow on the wall behind wall items (same quad, turned upright onto the wall).
    val shadowDepth = if (isWall) height else depth
    val padding = if (isWall) WALL_SHADOW_PADDING_M else CONTACT_SHADOW_PADDING_M + CONTACT_SHADOW_PADDING_RATIO * minOf(width, depth)
    val shadowMaterial = view.materialLoader.createInstance(contactShadowMaterial).apply {
      setParameter("halfFootprint", width / 2f, shadowDepth / 2f)
      setParameter("padding", padding)
      setParameter("opacity", if (isWall) WALL_SHADOW_OPACITY else CONTACT_SHADOW_OPACITY)
    }
    val contactShadow = PlaneNode(
      engine = view.engine,
      size = Size(width + 2 * padding, 0f, shadowDepth + 2 * padding), // y = 0: a flat quad (XZ)
      center = Position(0f, 0f, 0f),
      normal = Direction(0f, 1f, 0f),
      materialInstance = shadowMaterial,
    ).apply {
      isVisible = false
      isHittable = false
      isShadowCaster = false
      isShadowReceiver = false
      if (isWall) {
        rotation = Rotation(90f, 0f, 0f) // XZ quad -> upright on the wall (XY)
        position = Position(0f, -WALL_SHADOW_DROP_M, CONTACT_SHADOW_LIFT_M)
      } else {
        position = Position(0f, CONTACT_SHADOW_LIFT_M, 0f)
      }
    }
    pivot.addChildNode(contactShadow)

    anchorNode.addChildNode(pivot)
    view.addChildNode(anchorNode)

    return PlacedItem(
      instanceId = record.instanceId,
      productId = record.productId,
      category = record.category,
      width = width,
      depth = depth,
      height = height,
      anchorNode = anchorNode,
      pivot = pivot,
      footprint = footprint,
      contactShadow = contactShadow,
      contactShadowMaterial = shadowMaterial,
      isWallMounted = isWall,
    ).also { applyYaw(it, yaw) }
  }

  private fun attachModel(item: PlacedItem, buffer: ByteBuffer) {
    val view = sceneView ?: return
    val instance = view.modelLoader.createModelInstance(buffer)
    val modelNode = ModelNode(modelInstance = instance, autoAnimate = false).apply {
      isHittable = false
      isShadowCaster = true
      // No self-shadowing: with ARCore's estimated light, the arms/back threw dark patches
      // and shadow acne onto the upholstery. Materials carry their own shading.
      isShadowReceiver = false
      // Real scale (1:1, meters): never scaled. Put the model's bottom-center (wall items: the
      // center of its back face) on the pivot: a no-op for models authored to spec
      // (CLAUDE.md 4.5), and fixes ones that are not.
      val c = center
      val h = halfExtent
      position = if (item.isWallMounted) Position(-c.x, -c.y, -(c.z - h.z)) else Position(-c.x, -(c.y - h.y), -c.z)
    }
    item.pivot.addChildNode(modelNode)
    item.modelNode = modelNode
    // A model may bring its own contact shadow, baked in Blender (tools/models): darker under
    // each leg, soft under the seat, much more convincing than our generic one. It is a flat,
    // unlit, see-through quad on the floor: it must not cast or receive shadows itself.
    val bakedShadow = runCatching { modelNode.model.getEntitiesByName(BAKED_SHADOW_NODE) }.getOrNull() ?: IntArray(0)
    if (bakedShadow.isNotEmpty()) {
      bakedShadow.forEach { disableShadows(view, it) }
      item.hasBakedShadow = true
    }
    item.contactShadow.isVisible = !item.hasBakedShadow
    if (selected === item) updateControls()
  }

  /** Turns off shadow casting/receiving for an entity and its children. */
  private fun disableShadows(view: ARSceneView, entity: Int) {
    val renderables = view.engine.renderableManager
    renderables.getInstance(entity).takeIf { it != 0 }?.let {
      renderables.setCastShadows(it, false)
      renderables.setReceiveShadows(it, false)
    }
    val transforms = view.engine.transformManager
    val transform = transforms.getInstance(entity).takeIf { it != 0 } ?: return
    val children = IntArray(transforms.getChildCount(transform))
    transforms.getChildren(transform, children)
    children.forEach { disableShadows(view, it) }
  }

  private fun removeItemInternal(item: PlacedItem) {
    if (selected === item) select(null) // also takes the controls off it
    items.remove(item.instanceId)
    destroyItem(item)
  }

  private fun destroyItem(item: PlacedItem) {
    val view = sceneView ?: return
    item.cloudAnchor?.let { runCatching { it.detach() } }
    item.cloudAnchor = null
    runCatching { item.anchorNode.anchor.detach() }
    view.removeChildNode(item.anchorNode)
    item.modelNode?.let { node ->
      node.parent = null
      runCatching { view.modelLoader.destroyModel(node.model) }
    }
    runCatching { item.footprint.destroy() }
    runCatching { item.contactShadow.destroy() }
    runCatching { view.materialLoader.destroyMaterialInstance(item.contactShadowMaterial) }
    runCatching { item.pivot.destroy() }
    runCatching { item.anchorNode.destroy() }
  }

  private fun applyYaw(item: PlacedItem, yawRadians: Float) {
    item.yawRadians = yawRadians
    item.pivot.rotation = Rotation(0f, Math.toDegrees(yawRadians.toDouble()).toFloat(), 0f)
  }

  /** Re-anchors the item where the pivot currently is, so ARCore keeps tracking that spot. */
  private fun reanchor(item: PlacedItem, plane: Trackable?) {
    val session = sceneView?.session ?: return
    val p = item.pivot.worldPosition
    if (plane != null) item.hostPlane = plane
    val newAnchor = createAnchorOn(session, item.hostPlane, p.x, p.y, p.z)
    val oldAnchor = item.anchorNode.anchor
    item.anchorNode.anchor = newAnchor
    runCatching { oldAnchor.detach() }
    // Move the anchor node now (not on the next ARCore update) so the item does not flicker.
    item.anchorNode.worldPosition = p
    item.pivot.position = Position(0f, 0f, 0f)
  }

  // ---------------------------------------------------------------------------------------
  // Selection and highlight
  // ---------------------------------------------------------------------------------------

  private fun select(item: PlacedItem?) {
    if (trashItem !== item) trashItem = null
    if (selected !== item) {
      val previous = selected
      selected = item
      previous?.let { showFootprint(it) }
      item?.let { showFootprint(it) }
      onItemSelected(mapOf("instanceId" to item?.instanceId))
    }
    updateControls()
  }

  // ---------------------------------------------------------------------------------------
  // On-scene controls: move arrows and trash button
  // ---------------------------------------------------------------------------------------

  private fun createControls(view: ARSceneView) {
    iconMaterial = view.materialLoader.createMaterial(ICON_MATERIAL)
    fun icon(kind: Int, upright: Boolean, size: Float): MaterialInstance =
      view.materialLoader.createInstance(iconMaterial).apply {
        setParameter("kind", kind)
        setParameter("plane", if (upright) 1 else 0)
        setParameter("halfSize", size / 2f)
        setParameter("opacity", 1f)
      }.also { iconMaterialInstances += it }
    fun quad(material: MaterialInstance, upright: Boolean, size: Float) = PlaneNode(
      engine = view.engine,
      // Flat quads span X/Z (on the floor), upright ones X/Y (on a wall, or facing the camera).
      size = if (upright) Size(size, size, 0f) else Size(size, 0f, size),
      center = Position(0f, 0f, 0f),
      normal = if (upright) Direction(0f, 0f, 1f) else Direction(0f, 1f, 0f),
      materialInstance = material,
    ).apply {
      isVisible = false
      isHittable = false
      isShadowCaster = false
      isShadowReceiver = false
    }
    val flatArrow = icon(ICON_ARROW, upright = false, size = ARROW_SIZE_M)
    val uprightArrow = icon(ICON_ARROW, upright = true, size = ARROW_SIZE_M)
    floorArrows = ArMath.Handle.values().associateWith { quad(flatArrow, upright = false, size = ARROW_SIZE_M) }
    wallArrows = ArMath.Handle.values().associateWith { quad(uprightArrow, upright = true, size = ARROW_SIZE_M) }
    trashButton = quad(icon(ICON_TRASH, upright = true, size = TRASH_SIZE_M), upright = true, size = TRASH_SIZE_M)
  }

  private fun controlNodes(): List<PlaneNode> = floorArrows.values + wallArrows.values + trashButton

  /**
   * Puts the controls on the selected item (children of its pivot, so they follow drags,
   * twists and wall refinement): the trash button if it was double tapped, else the arrows.
   * Nothing while its model is loading or a snapshot is being taken.
   */
  private fun updateControls() {
    if (!::trashButton.isInitialized) return
    val item = selected?.takeIf { !it.isLoading && !controlsHidden }
    val showTrash = item != null && trashItem === item
    val arrows = if (item?.isWallMounted == true) wallArrows else floorArrows
    val unused = if (arrows === wallArrows) floorArrows else wallArrows
    unused.values.forEach { detachControl(it) }
    arrows.forEach { (handle, node) ->
      if (item == null || showTrash) {
        detachControl(node)
        return@forEach
      }
      val c = ArMath.handleCenter(
        handle, item.isWallMounted, item.width, item.depth, item.height,
        size = ARROW_SIZE_M, gap = ARROW_GAP_M, lift = if (item.isWallMounted) WALL_CONTROL_LIFT_M else ARROW_LIFT_M,
      )
      val angle = ArMath.handleAngleDegrees(handle)
      attachControl(node, item, Position(c.x, c.y, c.z), if (item.isWallMounted) Rotation(0f, 0f, angle) else Rotation(0f, angle, 0f))
    }
    if (showTrash && item != null) {
      // Floor items: floating above the item, turned to the camera every frame. Wall items:
      // over the middle of the item, facing out of the wall.
      val position = if (item.isWallMounted) {
        Position(0f, 0f, item.depth + WALL_CONTROL_LIFT_M)
      } else {
        Position(0f, item.height + TRASH_ABOVE_M, 0f)
      }
      attachControl(trashButton, item, position, Rotation(0f, 0f, 0f))
    } else {
      detachControl(trashButton)
    }
  }

  private fun attachControl(node: PlaneNode, item: PlacedItem, position: Position, rotation: Rotation) {
    if (node.parent !== item.pivot) node.parent = item.pivot
    node.position = position
    node.rotation = rotation
    node.isVisible = true
  }

  private fun detachControl(node: PlaneNode) {
    node.isVisible = false
    if (node.parent != null) node.parent = null
  }

  /** Keeps the trash button over a floor item facing the camera (yaw only, stays upright). */
  private fun faceTrashToCamera(frame: Frame) {
    val item = trashItem ?: return
    if (item.isWallMounted || !trashButton.isVisible) return
    val camera = frame.camera.pose
    val p = item.pivot.worldPosition
    val yaw = ArMath.yawFacing(from = ArMath.Vec3(p.x, p.y, p.z), target = ArMath.Vec3(camera.tx(), camera.ty(), camera.tz()))
    trashButton.rotation = Rotation(0f, Math.toDegrees((yaw - item.yawRadians).toDouble()).toFloat(), 0f)
  }

  /** Whether a screen point is on a visible control (a finger-sized radius around its center). */
  private fun isOnControl(node: PlaneNode, x: Float, y: Float): Boolean {
    if (!node.isVisible || node.parent == null) return false
    val p = node.worldPosition
    val (sx, sy) = screenPointOf(ArMath.Vec3(p.x, p.y, p.z)) ?: return false
    return hypot(sx - x, sy - y) <= CONTROL_TOUCH_RADIUS_DP * resources.displayMetrics.density
  }

  /** The selected item's arrow under a screen point (the closest, if several), or null. */
  private fun pickHandle(x: Float, y: Float): ArMath.Handle? {
    val item = selected ?: return null
    if (trashItem === item) return null
    val arrows = if (item.isWallMounted) wallArrows else floorArrows
    return arrows.entries
      .filter { isOnControl(it.value, x, y) }
      .minByOrNull { (_, node) ->
        val p = node.worldPosition
        screenPointOf(ArMath.Vec3(p.x, p.y, p.z))?.let { (sx, sy) -> hypot(sx - x, sy - y) } ?: Float.MAX_VALUE
      }?.key
  }

  /** Screen pixel of a world point from the current camera; null while not tracking or behind it. */
  private fun screenPointOf(point: ArMath.Vec3): Pair<Float, Float>? {
    val view = sceneView ?: return null
    val camera = view.frame?.camera ?: return null
    if (camera.trackingState != TrackingState.TRACKING) return null
    val viewMatrix = FloatArray(16).also { camera.getViewMatrix(it, 0) }
    val projection = FloatArray(16).also { camera.getProjectionMatrix(it, 0, NEAR_M, FAR_M) }
    return ArMath.project(point, view.width, view.height, viewMatrix, projection)
  }

  /** The user deleted an item with the trash button. */
  private fun deleteByUser(item: PlacedItem) {
    removeItemInternal(item)
    onItemRemoved(mapOf("instanceId" to item.instanceId, "productId" to item.productId))
  }

  // Arrow presses: one step on touch down, then repeating while the finger stays down.
  private var pressedHandle: Pair<PlacedItem, ArMath.Handle>? = null
  private val repeatNudge = object : Runnable {
    override fun run() {
      val (item, handle) = pressedHandle ?: return
      if (items[item.instanceId] !== item) return
      nudge(item, handle)
      mainHandler.postDelayed(this, NUDGE_REPEAT_MS)
    }
  }

  private fun startHandlePress(item: PlacedItem, handle: ArMath.Handle) {
    userMoved(item)
    pressedHandle = item to handle
    lastBlockedReason = null
    nudge(item, handle)
    mainHandler.postDelayed(repeatNudge, NUDGE_REPEAT_DELAY_MS)
  }

  private fun endHandlePress() {
    val (item, _) = pressedHandle ?: return
    pressedHandle = null
    mainHandler.removeCallbacks(repeatNudge)
    lastBlockedReason = null
    if (items[item.instanceId] !== item) return
    val p = item.pivot.worldPosition
    reanchor(item, if (item.isWallMounted) null else floorPlaneAt(p.x, p.z))
  }

  /**
   * Moves an item one step toward a handle (item-local direction, so "left" is the item's
   * left), with the same rules as a drag: collisions, floor items stay over the detected
   * floor, wall items above the floor.
   */
  private fun nudge(item: PlacedItem, handle: ArMath.Handle) {
    val step = ArMath.toWorld(ArMath.handleDirection(handle, item.isWallMounted), item.yawRadians) * NUDGE_STEP_M
    val p = item.pivot.worldPosition
    val target = Position(p.x + step.x, p.y + step.y, p.z + step.z)
    if (item.isWallMounted && !isAboveFloor(target.y, item.height)) {
      blocked(item, "noWall")
      return
    }
    if (!item.isWallMounted && floorPlaneAt(target.x, target.z) == null) {
      blocked(item, "noFloor")
      return
    }
    val reason = validateMove(item, target, item.yawRadians)
    if (reason != null) {
      blocked(item, reason)
      return
    }
    lastBlockedReason = null
    item.pivot.worldPosition = target
  }

  /**
   * Footprint is only drawn for the selected item. Hidden rather than made transparent:
   * a transparent PBR surface still shows specular reflections on the floor.
   */
  private fun showFootprint(item: PlacedItem, blocked: Boolean = false) {
    val visible = blocked || selected === item
    item.footprint.isVisible = visible
    if (visible) item.footprint.setMaterialInstanceAt(0, if (blocked) footprintBlocked else footprintSelected)
  }

  private fun restoreFootprints() {
    items.values.forEach { showFootprint(it) }
  }

  private fun flashBlocked(item: PlacedItem) {
    showFootprint(item, blocked = true)
    mainHandler.removeCallbacksAndMessages(BLOCKED_FLASH_TOKEN)
    mainHandler.postAtTime(
      {
        if (items[item.instanceId] === item) showFootprint(item)
      },
      BLOCKED_FLASH_TOKEN,
      android.os.SystemClock.uptimeMillis() + BLOCKED_FLASH_MS,
    )
  }

  // ---------------------------------------------------------------------------------------
  // Gestures: tap = select, double tap = trash button, press an arrow = nudge, one-finger
  // drag = move on the floor (wall items: along their wall), two-finger twist = yaw (floor
  // items only)
  // ---------------------------------------------------------------------------------------

  /** Last tap on an item, to detect a double tap. */
  private var lastTapItem: PlacedItem? = null
  private var lastTapTime = 0L

  private var downX = 0f
  private var downY = 0f
  private var downTime = 0L
  private var touchCandidate: PlacedItem? = null
  private var dragging: PlacedItem? = null
  private var grabOffsetX = 0f
  private var grabOffsetY = 0f
  private var grabOffsetZ = 0f
  /** Reason of the current blocked streak, so `onPlacementBlocked` is not sent every frame. */
  private var lastBlockedReason: String? = null
  /** Floor plane under the last valid drag position; the item is re-anchored on it. */
  private var dragPlane: Trackable? = null
  private var twistAngle: Float? = null
  /** Set once a multi-finger gesture happens, so lifting the last finger is not a tap. */
  private var gestureConsumed = false

  private fun handleTouch(event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        downX = event.x
        downY = event.y
        downTime = event.eventTime
        gestureConsumed = false
        twistAngle = null
        val handle = pickHandle(event.x, event.y)
        val item = selected
        if (handle != null && item != null) {
          // Arrows win over the item behind them; the press is neither a tap nor a drag.
          gestureConsumed = true
          touchCandidate = null
          startHandlePress(item, handle)
          return true
        }
        touchCandidate = pickItem(event.x, event.y)
      }

      MotionEvent.ACTION_POINTER_DOWN -> {
        gestureConsumed = true
        endHandlePress()
        endDrag()
        if (event.pointerCount >= 2 && selected?.isWallMounted == false) {
          twistAngle = ArMath.twistAngle(event.getX(0), event.getY(0), event.getX(1), event.getY(1))
        }
      }

      MotionEvent.ACTION_MOVE -> {
        val previous = twistAngle
        if (event.pointerCount >= 2 && previous != null) {
          val angle = ArMath.twistAngle(event.getX(0), event.getY(0), event.getX(1), event.getY(1))
          twistAngle = angle
          selected?.let { rotateBy(it, ArMath.yawDeltaForTwist(ArMath.angleDelta(previous, angle))) }
        } else if (event.pointerCount == 1 && !gestureConsumed) {
          val candidate = touchCandidate
          if (dragging == null && candidate != null && hypot(event.x - downX, event.y - downY) > touchSlop) {
            beginDrag(candidate, downX, downY)
          }
          dragging?.let { dragTo(it, event.x, event.y) }
        }
      }

      MotionEvent.ACTION_POINTER_UP -> {
        twistAngle = null
      }

      MotionEvent.ACTION_UP -> {
        endHandlePress()
        val wasDragging = dragging != null
        endDrag()
        val isTap = !wasDragging && !gestureConsumed &&
          event.eventTime - downTime < TAP_TIMEOUT_MS &&
          hypot(event.x - downX, event.y - downY) <= touchSlop
        if (isTap) onTap(event.x, event.y, event.eventTime)
        twistAngle = null
      }

      MotionEvent.ACTION_CANCEL -> {
        endHandlePress()
        endDrag()
        twistAngle = null
      }
    }
    return true
  }

  private fun onTap(x: Float, y: Float, time: Long) {
    trashItem?.let { item ->
      if (isOnControl(trashButton, x, y)) {
        deleteByUser(item)
        lastTapItem = null
        return
      }
      // A tap anywhere else dismisses the trash button (and is handled as a normal tap).
      trashItem = null
      updateControls()
    }
    val item = pickItem(x, y)
    if (item != null && item === lastTapItem && time - lastTapTime <= DOUBLE_TAP_MS) {
      lastTapItem = null
      select(item)
      trashItem = item
      updateControls()
      return
    }
    lastTapItem = item
    lastTapTime = time
    select(item)
    if (item != null) {
      onItemTapped(mapOf("instanceId" to item.instanceId, "productId" to item.productId))
    }
  }

  /** Item under a screen point, using each item's real-size box (not the mesh). */
  private fun pickItem(x: Float, y: Float): PlacedItem? {
    val candidates = items.values.filter { !it.isLoading }
    if (candidates.isEmpty()) return null
    val ray = screenRayAt(x, y) ?: return null
    val boxes = candidates.map { item ->
      val p = item.pivot.worldPosition
      val origin = ArMath.Vec3(p.x, p.y, p.z)
      if (item.isWallMounted) {
        ArMath.wallItemBox(origin, item.yawRadians, item.width, item.depth, item.height)
      } else {
        ArMath.StandingBox(origin, item.yawRadians, item.width, item.depth, item.height)
      }
    }
    return ArMath.pickClosest(ray, boxes)?.let { candidates[it] }
  }

  /** World ray through a screen point, from the current camera; null while not tracking. */
  private fun screenRayAt(x: Float, y: Float): ArMath.Ray? {
    val view = sceneView ?: return null
    val camera = view.frame?.camera ?: return null
    if (camera.trackingState != TrackingState.TRACKING) return null
    val viewMatrix = FloatArray(16).also { camera.getViewMatrix(it, 0) }
    val projection = FloatArray(16).also { camera.getProjectionMatrix(it, 0, NEAR_M, FAR_M) }
    return ArMath.screenRay(x, y, view.width, view.height, viewMatrix, projection)
  }

  /**
   * Where a screen point falls on a wall item's wall: its (infinite) plane, so the item can
   * slide past the patch ARCore has detected so far. Corners are still caught by collisions.
   */
  private fun wallPlaneHit(item: PlacedItem, x: Float, y: Float): ArMath.Vec3? {
    val ray = screenRayAt(x, y) ?: return null
    val p = item.pivot.worldPosition
    return ArMath.intersectPlane(ray, ArMath.Vec3(p.x, p.y, p.z), ArMath.forward(item.yawRadians))
  }

  private fun beginDrag(item: PlacedItem, x: Float, y: Float) {
    trashItem = null
    select(item)
    userMoved(item)
    dragging = item
    lastBlockedReason = null
    val p = item.pivot.worldPosition
    val hit = if (item.isWallMounted) {
      wallPlaneHit(item, x, y)
    } else {
      floorHitAt(x, y)?.hitPose?.let { ArMath.Vec3(it.tx(), it.ty(), it.tz()) }
    }
    // Keep the point under the finger fixed relative to the item, so it does not jump.
    grabOffsetX = if (hit != null) p.x - hit.x else 0f
    grabOffsetY = if (hit != null && item.isWallMounted) p.y - hit.y else 0f
    grabOffsetZ = if (hit != null) p.z - hit.z else 0f
  }

  private fun dragTo(item: PlacedItem, x: Float, y: Float) {
    if (item.isWallMounted) {
      dragOnWall(item, x, y)
      return
    }
    val floorHit = floorHitAt(x, y)
    if (floorHit == null) {
      blocked(item, "noFloor")
      return
    }
    val hit = floorHit.hitPose
    val target = Position(hit.tx() + grabOffsetX, hit.ty(), hit.tz() + grabOffsetZ)
    val reason = validateMove(item, target, item.yawRadians)
    if (reason != null) {
      blocked(item, reason)
      return
    }
    lastBlockedReason = null
    dragPlane = floorHit.trackable
    item.pivot.worldPosition = target
  }

  /** Wall items slide along their wall's plane and stay above the floor. */
  private fun dragOnWall(item: PlacedItem, x: Float, y: Float) {
    val hit = wallPlaneHit(item, x, y)
    if (hit == null) {
      blocked(item, "noWall")
      return
    }
    val target = Position(hit.x + grabOffsetX, hit.y + grabOffsetY, hit.z + grabOffsetZ)
    if (!isAboveFloor(target.y, item.height)) {
      blocked(item, "noWall")
      return
    }
    val reason = validateMove(item, target, item.yawRadians)
    if (reason != null) {
      blocked(item, reason)
      return
    }
    lastBlockedReason = null
    item.pivot.worldPosition = target
  }

  private fun endDrag() {
    val item = dragging ?: return
    dragging = null
    lastBlockedReason = null
    if (items[item.instanceId] === item) reanchor(item, dragPlane)
    dragPlane = null
  }

  private fun rotateBy(item: PlacedItem, deltaYaw: Float) {
    if (item.isWallMounted) return // wall items keep facing out of their wall
    val newYaw = item.yawRadians + deltaYaw
    val reason = validateMove(item, item.pivot.worldPosition, newYaw)
    if (reason != null) {
      blocked(item, reason)
      return
    }
    lastBlockedReason = null
    userMoved(item)
    applyYaw(item, newYaw)
  }

  /**
   * Whether [item] may take this pose (CLAUDE.md 4.4). Returns 'wall' | 'item', or null.
   * Computed natively every frame of a drag/rotate; poses never cross the JS bridge.
   */
  private fun validateMove(item: PlacedItem, position: Position, yawRadians: Float): String? {
    return CollisionMath.blockedReason(
      moving = bodyOf(item),
      candidate = footprintOf(item, position, yawRadians),
      current = footprintOf(item, item.pivot.worldPosition, item.yawRadians),
      others = items.values.filter { it !== item }.map(::bodyOf),
      walls = walls,
    )?.jsName
  }

  private fun bodyOf(item: PlacedItem): CollisionMath.Body = CollisionMath.Body(
    id = item.instanceId,
    footprint = footprintOf(item, item.pivot.worldPosition, item.yawRadians),
    isFloorCovering = item.category == FLOOR_COVERING_CATEGORY,
    isWallMounted = item.isWallMounted,
  )

  private fun footprintOf(item: PlacedItem, pivot: Position, yawRadians: Float) =
    footprintAt(item.isWallMounted, pivot, yawRadians, item.width, item.depth, item.height)

  /**
   * Collision footprint (with height range) of an item whose pivot is at [pivot]. Floor items:
   * the pivot is the footprint center on the floor. Wall items: the pivot is the center of
   * the back face, so the footprint sits in front of it and the range is centered on it.
   */
  private fun footprintAt(
    isWall: Boolean,
    pivot: Position,
    yawRadians: Float,
    width: Float,
    depth: Float,
    height: Float,
  ): CollisionMath.Footprint {
    if (!isWall) {
      return CollisionMath.Footprint(pivot.x, pivot.z, yawRadians, width, depth, pivot.y, pivot.y + height)
    }
    val f = ArMath.forward(yawRadians)
    return CollisionMath.Footprint(
      pivot.x + f.x * depth / 2f, pivot.z + f.z * depth / 2f, yawRadians, width, depth,
      pivot.y - height / 2f, pivot.y + height / 2f,
    )
  }

  /**
   * Keeps the last valid pose, flashes red and emits `onPlacementBlocked` once per blocked
   * streak (again only if the reason changes, e.g. from 'wall' to 'item').
   */
  private fun blocked(item: PlacedItem, reason: String) {
    if (reason == lastBlockedReason) return
    lastBlockedReason = reason
    flashBlocked(item)
    onPlacementBlocked(mapOf("instanceId" to item.instanceId, "reason" to reason))
  }

  // ---------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------

  private fun emitTrackingState(state: String) {
    if (state == lastTrackingState) return
    lastTrackingState = state
    onTrackingStateChanged(mapOf("state" to state))
  }

  private fun emitError(code: String, message: String) {
    onError(mapOf("code" to code, "message" to message))
  }

  private fun readDirectBuffer(file: File): ByteBuffer {
    val bytes = file.readBytes()
    return ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder()).put(bytes).apply { flip() }
  }

  private fun saveJpeg(bitmap: Bitmap): File {
    val dir = File(context.cacheDir, "furniture-ar-snapshots").apply { mkdirs() }
    val file = File(dir, "ar-${System.currentTimeMillis()}.jpg")
    FileOutputStream(file).use { bitmap.compress(Bitmap.CompressFormat.JPEG, 92, it) }
    return file
  }

  private companion object {
    const val TAG = "FurnitureAR"
    const val DEPTH_OCCLUSION_MATERIAL = "materials/furniture_camera_depth.filamat"
    const val NEUTRAL_IBL_ASSET = "environments/neutral/neutral_ibl.ktx"
    /** Filament's default IBL intensity; matches SceneView's sunny-16 AR camera exposure. */
    const val NEUTRAL_IBL_INTENSITY = 30_000f
    /**
     * Depth occlusion is OFF for now: on device (Galaxy Z Flip6) ARCore depth is noisy near
     * the image edges and cut flickering holes in furniture while moving, even with the
     * margin in furniture_camera_depth.mat. Pending a decision (CLAUDE.md 4.3 asks for it).
     */
    const val DEPTH_OCCLUSION_ENABLED = false
    const val CONTACT_SHADOW_MATERIAL = "materials/furniture_contact_shadow.filamat"
    const val ICON_MATERIAL = "materials/furniture_icon.filamat"
    /** How long a saved scene's cloud anchor lives (ARCore's maximum; needs keyless auth). */
    const val CLOUD_ANCHOR_TTL_DAYS = 365
    /**
     * How long a save waits for the user to show ARCore enough of the spot. Was 40 s: on device
     * the local estimate never left INSUFFICIENT, so every save waited the full time, and every
     * upload after the wait succeeded.
     */
    const val CLOUD_ANCHOR_MAPPING_TIMEOUT_MS = 15_000L
    /** For hosting, an item counts as seen when it is on screen and this close to the camera. */
    const val CLOUD_ANCHOR_VIEW_DISTANCE_M = 5f
    /** A found cloud anchor is reported after being tracked this long (at most the max). */
    const val CLOUD_ANCHOR_SETTLE_MS = 1_500L
    const val CLOUD_ANCHOR_SETTLE_MAX_MS = 4_000L
    /** Restored items follow their cloud anchor: share of the gap closed per frame, dead-bands. */
    const val CLOUD_FOLLOW_GAIN = 0.15f
    const val CLOUD_FOLLOW_DEADBAND_M = 0.002f
    const val CLOUD_FOLLOW_DEADBAND_RAD = 0.003f
    /** Floor settling: how often, dead-band, largest believable offset, share fixed per pass. */
    const val FLOOR_SETTLE_INTERVAL_NS = 200_000_000L
    const val FLOOR_SETTLE_DEADBAND_M = 0.003f
    const val FLOOR_SETTLE_MAX_OFFSET_M = 0.15f
    const val FLOOR_SETTLE_GAIN = 0.3f
    /** Depth samples under a floor item: a 3x3 grid at these shares of its half width/depth. */
    val FLOOR_SAMPLE_FRACTIONS = floatArrayOf(-0.6f, 0f, 0.6f)
    const val FLOOR_SAMPLE_MAX_HORIZONTAL_M = 0.12f
    const val FLOOR_SAMPLE_MIN_COUNT = 4
    /** A model's own baked contact shadow: the glTF node with this name (tools/models/README.md). */
    const val BAKED_SHADOW_NODE = "ContactShadow"
    /** `kind` values of furniture_icon.mat. */
    const val ICON_ARROW = 0
    const val ICON_TRASH = 1
    /** Move arrows: size, distance from the item's edge, height above the floor (over the footprint). */
    const val ARROW_SIZE_M = 0.14f
    const val ARROW_GAP_M = 0.05f
    const val ARROW_LIFT_M = 0.012f
    /** Wall items: controls this far in front of the wall. */
    const val WALL_CONTROL_LIFT_M = 0.008f
    const val TRASH_SIZE_M = 0.16f
    /** Trash button over a floor item: this far above its top. */
    const val TRASH_ABOVE_M = 0.14f
    /** Touch radius around a control's center (dp). */
    const val CONTROL_TOUCH_RADIUS_DP = 32f
    /** One arrow tap moves this far; holding repeats after a delay. */
    const val NUDGE_STEP_M = 0.05f
    const val NUDGE_REPEAT_DELAY_MS = 400L
    const val NUDGE_REPEAT_MS = 110L
    const val DOUBLE_TAP_MS = 350L
    /** Shadow fades out this far beyond the footprint: fixed part + share of the smaller side. */
    const val CONTACT_SHADOW_PADDING_M = 0.08f
    const val CONTACT_SHADOW_PADDING_RATIO = 0.15f
    const val CONTACT_SHADOW_OPACITY = 0.55f
    /** Just above the floor (and below the 4 mm footprint) to avoid z-fighting. */
    const val CONTACT_SHADOW_LIFT_M = 0.002f
    /** Category whose items ignore furniture collisions (CLAUDE.md 4.4); see isFloorCovering in shared. */
    const val FLOOR_COVERING_CATEGORY = "rug"
    /** Category whose items hang on walls (CLAUDE.md 4.2); see isWallMounted in shared. */
    const val WALL_ART_CATEGORY = "wall-art"
    /** Wall items: highlight border around the item, and a soft drop shadow on the wall. */
    const val WALL_HALO_M = 0.02f
    const val WALL_SHADOW_PADDING_M = 0.035f
    const val WALL_SHADOW_OPACITY = 0.35f
    const val WALL_SHADOW_DROP_M = 0.015f
    /** Wall refinement: how often, where on the item's back face to sample (fractions of its
     * half width/height), and the limits. Gain = share of the measured error fixed per pass. */
    const val WALL_REFINE_INTERVAL_NS = 200_000_000L
    val WALL_REFINE_U = floatArrayOf(-0.9f, -0.45f, 0f, 0.45f, 0.9f)
    val WALL_REFINE_V = floatArrayOf(-0.8f, 0f, 0.8f)
    const val WALL_REFINE_MAX_OFFSET_M = 0.10f
    const val WALL_REFINE_MAX_TURN_RAD = 0.35f // ~20 degrees
    const val WALL_REFINE_DEADBAND_RAD = 0.0087f // ~0.5 degree
    const val WALL_REFINE_DEADBAND_M = 0.003f
    const val WALL_REFINE_GAIN = 0.3f
    /** Plain-wall fallback: depth samples at ±this share of the smaller screen side. */
    const val WALL_SAMPLE_SPREAD = 0.18f
    /** A wall item's bottom edge may touch the floor (within this), not go through it. */
    const val FLOOR_CONTACT_SLACK_M = 0.01f
    /** Vertical planes narrower than this are not treated as walls. */
    const val MIN_WALL_LENGTH_M = 0.2f
    /** Upward planes up to this height above the lowest one still count as floor. */
    const val FLOOR_TOLERANCE_M = 0.15f
    const val FOOTPRINT_THICKNESS_M = 0.004f
    const val NEAR_M = 0.05f
    const val FAR_M = 100f
    const val TAP_TIMEOUT_MS = 300L
    const val BLOCKED_FLASH_MS = 350L
    const val SNAPSHOT_DELAY_MS = 50L
    val BLOCKED_FLASH_TOKEN = Any()
  }
}
