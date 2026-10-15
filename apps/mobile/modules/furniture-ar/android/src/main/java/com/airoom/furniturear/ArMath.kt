package com.airoom.furniturear

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin

/**
 * Pure geometry used by the AR view: screen rays, item picking and gesture angles.
 * No Android or ARCore types, so it runs in plain JVM unit tests.
 *
 * Conventions: world is Y-up, meters. An item's yaw is a rotation around +Y in radians
 * (counter-clockwise seen from above); its front is local +Z. Floor items have their origin
 * at the bottom center; wall items (wall art) at the center of their back face.
 */
internal object ArMath {

  data class Vec3(val x: Float, val y: Float, val z: Float) {
    operator fun minus(o: Vec3) = Vec3(x - o.x, y - o.y, z - o.z)
    operator fun plus(o: Vec3) = Vec3(x + o.x, y + o.y, z + o.z)
    operator fun times(s: Float) = Vec3(x * s, y * s, z * s)
  }

  data class Ray(val origin: Vec3, val direction: Vec3)

  /** Oriented box standing on its bottom face: footprint `width × depth`, `height` tall. */
  data class StandingBox(
    val bottomCenter: Vec3,
    val yawRadians: Float,
    val width: Float,
    val depth: Float,
    val height: Float,
  )

  /**
   * Ray through a screen pixel, built from column-major 4x4 view and projection matrices
   * (the layout ARCore's `Camera.getViewMatrix`/`getProjectionMatrix` return).
   */
  fun screenRay(
    xPx: Float,
    yPx: Float,
    viewWidth: Int,
    viewHeight: Int,
    view: FloatArray,
    projection: FloatArray,
  ): Ray? {
    if (viewWidth <= 0 || viewHeight <= 0) return null
    val ndcX = 2f * xPx / viewWidth - 1f
    val ndcY = 1f - 2f * yPx / viewHeight
    val inverseViewProjection = invert(multiply(projection, view)) ?: return null
    val near = unproject(inverseViewProjection, ndcX, ndcY, -1f) ?: return null
    val far = unproject(inverseViewProjection, ndcX, ndcY, 1f) ?: return null
    return Ray(near, normalize(far - near) ?: return null)
  }

  /**
   * Screen pixel of a world point (inverse of [screenRay]), from column-major view and
   * projection matrices; null if the point is behind the camera.
   */
  fun project(point: Vec3, viewWidth: Int, viewHeight: Int, view: FloatArray, projection: FloatArray): Pair<Float, Float>? {
    val m = multiply(projection, view)
    val cx = m[0] * point.x + m[4] * point.y + m[8] * point.z + m[12]
    val cy = m[1] * point.x + m[5] * point.y + m[9] * point.z + m[13]
    val cw = m[3] * point.x + m[7] * point.y + m[11] * point.z + m[15]
    if (cw <= EPSILON) return null
    return ((cx / cw + 1f) / 2f * viewWidth) to ((1f - cy / cw) / 2f * viewHeight)
  }

  /**
   * Distance along [ray] to the first hit with [box], or null if it misses.
   * The ray is moved into the box's local frame, then a slab test is run.
   */
  fun intersect(ray: Ray, box: StandingBox): Float? {
    val local = toLocal(ray.origin - box.bottomCenter, box.yawRadians)
    val dir = toLocal(ray.direction, box.yawRadians)
    val halfW = box.width / 2f
    val halfD = box.depth / 2f

    var tMin = Float.NEGATIVE_INFINITY
    var tMax = Float.POSITIVE_INFINITY
    val slabs = arrayOf(
      Triple(local.x, dir.x, -halfW to halfW),
      Triple(local.y, dir.y, 0f to box.height),
      Triple(local.z, dir.z, -halfD to halfD),
    )
    for ((o, d, range) in slabs) {
      val (lo, hi) = range
      if (abs(d) < EPSILON) {
        if (o < lo || o > hi) return null
        continue
      }
      var t1 = (lo - o) / d
      var t2 = (hi - o) / d
      if (t1 > t2) t1 = t2.also { t2 = t1 }
      tMin = maxOf(tMin, t1)
      tMax = minOf(tMax, t2)
      if (tMin > tMax) return null
    }
    if (tMax < 0f) return null
    return if (tMin >= 0f) tMin else 0f
  }

  /**
   * Where [ray] crosses the plane through [point] with [normal], or null if it runs parallel
   * to it or the plane is behind the ray. Used to drag wall items along their wall's
   * (infinite) plane, beyond the patch ARCore has detected.
   */
  fun intersectPlane(ray: Ray, point: Vec3, normal: Vec3): Vec3? {
    val denom = dot(ray.direction, normal)
    if (abs(denom) < EPSILON) return null
    val t = dot(point - ray.origin, normal) / denom
    if (t < 0f) return null
    return ray.origin + ray.direction * t
  }

  /** Direction of an item's front (local +Z) for a yaw. */
  fun forward(yawRadians: Float) = Vec3(sin(yawRadians), 0f, cos(yawRadians))

  /** The box of a wall item whose back face is centered on [backCenter], facing [yawRadians]. */
  fun wallItemBox(backCenter: Vec3, yawRadians: Float, width: Float, depth: Float, height: Float): StandingBox {
    val bottomCenter = backCenter + forward(yawRadians) * (depth / 2f) - Vec3(0f, height / 2f, 0f)
    return StandingBox(bottomCenter, yawRadians, width, depth, height)
  }

  /** Index of the closest box hit by [ray], or null. */
  fun pickClosest(ray: Ray, boxes: List<StandingBox>): Int? {
    var best: Int? = null
    var bestT = Float.POSITIVE_INFINITY
    boxes.forEachIndexed { i, box ->
      val t = intersect(ray, box)
      if (t != null && t < bestT) {
        bestT = t
        best = i
      }
    }
    return best
  }

  /** Angle of the line between two touch points, in screen space (y down), radians. */
  fun twistAngle(x0: Float, y0: Float, x1: Float, y1: Float): Float = atan2(y1 - y0, x1 - x0)

  /** Smallest signed difference `to - from`, wrapped into (-π, π]. */
  fun angleDelta(from: Float, to: Float): Float {
    var d = (to - from) % TWO_PI
    if (d > PI_F) d -= TWO_PI
    if (d <= -PI_F) d += TWO_PI
    return d
  }

  /**
   * Yaw change for a two-finger twist. A clockwise twist on screen (looking down at the
   * floor) turns the item clockwise seen from above, which is a negative yaw.
   */
  fun yawDeltaForTwist(screenAngleDelta: Float): Float = -screenAngleDelta

  /** Yaw that turns an item's front (+Z) toward [target], seen from above. */
  fun yawFacing(from: Vec3, target: Vec3): Float = atan2(target.x - from.x, target.z - from.z)

  /**
   * Yaw that turns a wall item's front (+Z) out of a wall with [normal], toward the side of
   * the wall [viewer] is on (ARCore's plane normal may point either way). Null if the normal
   * is not close enough to horizontal for a wall.
   */
  fun yawOutOfWall(normal: Vec3, wallPoint: Vec3, viewer: Vec3): Float? {
    val len = kotlin.math.sqrt(normal.x * normal.x + normal.z * normal.z)
    if (len < MIN_WALL_NORMAL_XZ) return null
    var nx = normal.x / len
    var nz = normal.z / len
    if ((viewer.x - wallPoint.x) * nx + (viewer.z - wallPoint.z) * nz < 0f) {
      nx = -nx
      nz = -nz
    }
    return atan2(nx, nz)
  }

  /**
   * Yaw of a wall item on a wall measured as loose 3D points (Depth API / feature-point hits
   * around the aimed spot), for plain walls ARCore never turns into a plane.
   *
   * Seen from above, points on a wall lie on a line: fits that line (principal axis of the
   * X/Z positions), dropping the worst outlier while any point is more than
   * [WALL_FIT_MAX_RESIDUAL_M] off it (e.g. a sample that landed on the floor), and returns
   * the yaw facing out of it toward [viewer]. Null when there are too few points, they are
   * not spread enough to give a direction, or they don't form a line (a floor, a corner).
   */
  fun wallYawFromPoints(points: List<Vec3>, viewer: Vec3): Float? {
    var pts = points
    while (pts.size >= WALL_FIT_MIN_POINTS) {
      val fit = fitLineXZ(pts) ?: return null
      val residuals = pts.map { abs((it.x - fit.cx) * fit.nx + (it.z - fit.cz) * fit.nz) }
      val worst = residuals.indices.maxByOrNull { residuals[it] }!!
      if (residuals[worst] <= WALL_FIT_MAX_RESIDUAL_M) {
        if (fit.spread < WALL_FIT_MIN_SPREAD_M) return null
        return yawOutOfWall(Vec3(fit.nx, 0f, fit.nz), Vec3(fit.cx, 0f, fit.cz), viewer)
      }
      pts = pts.filterIndexed { i, _ -> i != worst }
    }
    return null
  }

  /** Line through points seen from above: center, unit normal, spread (std dev) along it. */
  private class LineXZ(val cx: Float, val cz: Float, val nx: Float, val nz: Float, val spread: Float)

  private fun fitLineXZ(points: List<Vec3>): LineXZ? {
    val cx = points.map { it.x }.average().toFloat()
    val cz = points.map { it.z }.average().toFloat()
    var xx = 0f
    var xz = 0f
    var zz = 0f
    for (p in points) {
      val dx = p.x - cx
      val dz = p.z - cz
      xx += dx * dx
      xz += dx * dz
      zz += dz * dz
    }
    xx /= points.size
    xz /= points.size
    zz /= points.size
    // Largest eigenvalue of the 2x2 covariance and its eigenvector = the line's direction.
    val half = (xx + zz) / 2f
    val major = half + kotlin.math.sqrt(maxOf(half * half - (xx * zz - xz * xz), 0f))
    var dx = if (abs(xz) > 1e-9f) major - zz else if (xx >= zz) 1f else 0f
    var dz = if (abs(xz) > 1e-9f) xz else if (xx >= zz) 0f else 1f
    val len = kotlin.math.sqrt(dx * dx + dz * dz)
    if (len < EPSILON) return null
    dx /= len
    dz /= len
    return LineXZ(cx, cz, -dz, dx, kotlin.math.sqrt(major))
  }

  /** Rotates [v] by `-yaw` around Y (world → item-local). */
  fun toLocal(v: Vec3, yawRadians: Float): Vec3 {
    val c = cos(yawRadians)
    val s = sin(yawRadians)
    return Vec3(c * v.x - s * v.z, v.y, s * v.x + c * v.z)
  }

  /** Rotates [v] by `yaw` around Y (item-local → world); the inverse of [toLocal]. */
  fun toWorld(v: Vec3, yawRadians: Float): Vec3 {
    val c = cos(yawRadians)
    val s = sin(yawRadians)
    return Vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z)
  }

  /** Where a wall item ends up when snapped onto a wall: back-center X/Z and yaw. */
  data class WallSnap(val x: Float, val z: Float, val yawRadians: Float)

  /**
   * Snaps a wall item whose back center is at ([x], [z]) with [yawRadians] onto the closest
   * detected wall that faces the same way (within [maxAngleRad]), is at most [maxDistance]
   * in front of or behind its back, and spans its position (with [alongMargin] past the
   * detected ends). Moves it along the wall's normal and turns it to face straight out of the
   * wall. Null when no wall qualifies. Used when rebuilding a saved scene: the saved offset
   * and today's wall estimate are each off by a few cm.
   */
  fun snapToWall(
    x: Float,
    z: Float,
    yawRadians: Float,
    walls: List<CollisionMath.Segment>,
    maxDistance: Float = SNAP_MAX_DISTANCE_M,
    maxAngleRad: Float = SNAP_MAX_ANGLE_RAD,
    alongMargin: Float = SNAP_ALONG_MARGIN_M,
  ): WallSnap? {
    val f = forward(yawRadians)
    var best: WallSnap? = null
    var bestDistance = Float.POSITIVE_INFINITY
    for (s in walls) {
      val len = kotlin.math.hypot(s.x2 - s.x1, s.z2 - s.z1)
      if (len < EPSILON) continue
      val ux = (s.x2 - s.x1) / len
      val uz = (s.z2 - s.z1) / len
      // Wall normal on the item's front side.
      var nx = -uz
      var nz = ux
      if (nx * f.x + nz * f.z < 0f) {
        nx = -nx
        nz = -nz
      }
      if (nx * f.x + nz * f.z < cos(maxAngleRad)) continue
      val along = (x - s.x1) * ux + (z - s.z1) * uz
      if (along < -alongMargin || along > len + alongMargin) continue
      val distance = (x - s.x1) * nx + (z - s.z1) * nz // + = in front of the wall
      if (abs(distance) > maxDistance || abs(distance) >= bestDistance) continue
      bestDistance = abs(distance)
      best = WallSnap(x - nx * distance, z - nz * distance, atan2(nx, nz))
    }
    return best
  }

  /**
   * One smoothing step of a restored item toward its cloud anchor's current position: the
   * translation to apply now (a [gain] share of the remaining gap; zero within [deadband]).
   * Floor items move across the floor only (their height is the floor's, see [floorFromSamples]);
   * wall items only along their wall (distance from the wall and angle belong to the wall
   * refinement), so the two corrections never fight.
   */
  fun followStep(current: Vec3, target: Vec3, yawRadians: Float, isWall: Boolean, gain: Float, deadband: Float): Vec3 {
    val d = target - current
    val along = if (isWall) {
      val n = forward(yawRadians)
      d - n * dot(d, n)
    } else {
      Vec3(d.x, 0f, d.z)
    }
    val length = kotlin.math.sqrt(dot(along, along))
    return if (length < deadband) Vec3(0f, 0f, 0f) else along * gain
  }

  /**
   * Floor height under an item from loose depth / feature-point hits: [hits][i] is what the ray
   * toward [expected][i] (a point on the floor under the item, at its current height) actually
   * hit, or null. Hits that landed elsewhere (a real chair in front: more than
   * [maxHorizontal] off the expected spot) or too far above/below ([maxOffset], e.g. a table)
   * are dropped; the median of the rest, if at least [minCount], is the floor.
   */
  fun floorFromSamples(
    expected: List<Vec3>,
    hits: List<Vec3?>,
    maxHorizontal: Float,
    maxOffset: Float,
    minCount: Int,
  ): Float? {
    val heights = expected.indices.mapNotNull { i ->
      val hit = hits.getOrNull(i) ?: return@mapNotNull null
      val e = expected[i]
      val horizontal = kotlin.math.hypot(hit.x - e.x, hit.z - e.z)
      if (horizontal > maxHorizontal || abs(hit.y - e.y) > maxOffset) null else hit.y
    }.sorted()
    if (heights.size < minCount) return null
    val mid = heights.size / 2
    return if (heights.size % 2 == 1) heights[mid] else (heights[mid - 1] + heights[mid]) / 2f
  }

  /** The four move arrows around a selected item, named as the user sees them. */
  enum class Handle { LEFT, RIGHT, TOP, BOTTOM }

  /**
   * Item-local unit direction a handle moves the item. Floor items move along the floor
   * (TOP = away from their front, -Z; BOTTOM = toward it, +Z); wall items along their wall
   * (TOP = up).
   */
  fun handleDirection(handle: Handle, isWall: Boolean): Vec3 = when (handle) {
    Handle.LEFT -> Vec3(-1f, 0f, 0f)
    Handle.RIGHT -> Vec3(1f, 0f, 0f)
    Handle.TOP -> if (isWall) Vec3(0f, 1f, 0f) else Vec3(0f, 0f, -1f)
    Handle.BOTTOM -> if (isWall) Vec3(0f, -1f, 0f) else Vec3(0f, 0f, 1f)
  }

  /**
   * Item-local center of a handle's arrow: [gap] beyond the edge it points away from, plus
   * half the arrow [size]. Floor items: on the floor, raised by [lift]; wall items: on the
   * wall, [lift] in front of it.
   */
  fun handleCenter(handle: Handle, isWall: Boolean, width: Float, depth: Float, height: Float, size: Float, gap: Float, lift: Float): Vec3 {
    val d = handleDirection(handle, isWall)
    val reach = size / 2f + gap
    return if (isWall) {
      Vec3(d.x * (width / 2f + reach), d.y * (height / 2f + reach), lift)
    } else {
      Vec3(d.x * (width / 2f + reach), lift, d.z * (depth / 2f + reach))
    }
  }

  /**
   * Rotation (degrees) that turns an arrow drawn toward local +X into its handle's direction:
   * around Y for floor arrows (flat, XZ), around Z for wall arrows (upright, XY).
   */
  fun handleAngleDegrees(handle: Handle): Float = when (handle) {
    Handle.RIGHT -> 0f
    Handle.LEFT -> 180f
    Handle.TOP -> 90f
    Handle.BOTTOM -> -90f
  }

  fun dot(a: Vec3, b: Vec3) = a.x * b.x + a.y * b.y + a.z * b.z

  fun normalize(v: Vec3): Vec3? {
    val len = kotlin.math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
    return if (len < EPSILON) null else v * (1f / len)
  }

  /** Column-major 4x4 multiply: a * b. */
  fun multiply(a: FloatArray, b: FloatArray): FloatArray {
    val out = FloatArray(16)
    for (col in 0 until 4) {
      for (row in 0 until 4) {
        var sum = 0f
        for (k in 0 until 4) sum += a[k * 4 + row] * b[col * 4 + k]
        out[col * 4 + row] = sum
      }
    }
    return out
  }

  /** Inverse of a column-major 4x4 matrix, or null if singular. */
  fun invert(m: FloatArray): FloatArray? {
    val inv = FloatArray(16)
    inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10]
    inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10]
    inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9]
    inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9]
    inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10]
    inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10]
    inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9]
    inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9]
    inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6]
    inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6]
    inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5]
    inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5]
    inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6]
    inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6]
    inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5]
    inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5]

    val det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12]
    if (abs(det) < 1e-12f) return null
    val invDet = 1f / det
    for (i in 0 until 16) inv[i] *= invDet
    return inv
  }

  private fun unproject(inverseViewProjection: FloatArray, x: Float, y: Float, z: Float): Vec3? {
    val m = inverseViewProjection
    val rx = m[0] * x + m[4] * y + m[8] * z + m[12]
    val ry = m[1] * x + m[5] * y + m[9] * z + m[13]
    val rz = m[2] * x + m[6] * y + m[10] * z + m[14]
    val rw = m[3] * x + m[7] * y + m[11] * z + m[15]
    if (abs(rw) < EPSILON) return null
    return Vec3(rx / rw, ry / rw, rz / rw)
  }

  const val SNAP_MAX_DISTANCE_M = 0.25f
  const val SNAP_MAX_ANGLE_RAD = 0.26f // ~15 degrees
  const val SNAP_ALONG_MARGIN_M = 0.5f
  private const val EPSILON = 1e-6f
  /** Horizontal part of a wall's normal: below this (about 60° off vertical walls) it is no wall. */
  private const val MIN_WALL_NORMAL_XZ = 0.5f
  /** Wall fit from loose points: enough points, spread, and how far one may be off the line. */
  private const val WALL_FIT_MIN_POINTS = 4
  private const val WALL_FIT_MIN_SPREAD_M = 0.05f
  private const val WALL_FIT_MAX_RESIDUAL_M = 0.03f
  private const val PI_F = PI.toFloat()
  private const val TWO_PI = (2 * PI).toFloat()
}
