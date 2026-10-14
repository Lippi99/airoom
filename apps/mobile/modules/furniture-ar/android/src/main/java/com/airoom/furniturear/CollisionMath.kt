package com.airoom.furniturear

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Collision geometry on the floor plane (X/Z), CLAUDE.md 4.4. Pure Kotlin, no Android/ARCore
 * types; the Swift `CollisionMath` must implement the same algorithm and pass the same
 * cases (`modules/furniture-ar/collision-cases.json`).
 *
 * - An item is its footprint: a rectangle (width along local X, depth along local Z) rotated
 *   by `yaw` around +Y (counter-clockwise seen from above).
 * - Item vs item: Separating Axis Theorem; colliding unless separated by more than `margin`.
 * - Item vs wall: walls are segments on the floor; same SAT test with the segment as a
 *   degenerate polygon.
 * - Floor coverings (rugs) ignore furniture, but collide with walls and other rugs.
 * - Vertical extent (optional): two items only collide if their height ranges overlap too,
 *   so a painting can hang above a sofa but not behind a bookcase. Floor items span from
 *   the floor up; without an extent an item spans all heights (the 2D rules above).
 * - Wall-mounted items (wall art) ignore their host wall, the one they hang on: any wall
 *   parallel to the item's back and within [HOST_WALL_DISTANCE_M] of it (ARCore often
 *   detects the same wall as several planes). Other walls (corners) still block them.
 */
internal object CollisionMath {

  const val DEFAULT_MARGIN_M = 0.01f
  /** A wall this close to a wall item's back, and parallel to it, is the one it hangs on. */
  const val HOST_WALL_DISTANCE_M = 0.06f
  /** "Parallel" for host walls: within about 10 degrees (sine of the angle). */
  const val HOST_WALL_MAX_SIN = 0.17f

  data class Vec2(val x: Float, val z: Float)

  /**
   * The rectangle an item covers on the floor, plus its height range [bottom, top] (world Y).
   * The default range spans all heights.
   */
  data class Footprint(
    val x: Float,
    val z: Float,
    val yawRadians: Float,
    val width: Float,
    val depth: Float,
    val bottom: Float = Float.NEGATIVE_INFINITY,
    val top: Float = Float.POSITIVE_INFINITY,
  ) {
    /** Corners in world X/Z, counter-clockwise. */
    fun corners(): List<Vec2> {
      val c = cos(yawRadians)
      val s = sin(yawRadians)
      val hw = width / 2f
      val hd = depth / 2f
      return listOf(-hw to -hd, hw to -hd, hw to hd, -hw to hd).map { (lx, lz) ->
        // Rotation around +Y: x' = cos·x + sin·z, z' = −sin·x + cos·z (same as ArMath).
        Vec2(x + c * lx + s * lz, z - s * lx + c * lz)
      }
    }

    /** Direction of local +Z (the item's front) in world X/Z. */
    fun forward() = Vec2(sin(yawRadians), cos(yawRadians))
  }

  data class Segment(val x1: Float, val z1: Float, val x2: Float, val z2: Float) {
    fun points() = listOf(Vec2(x1, z1), Vec2(x2, z2))
  }

  /** A placed item as seen by the collision rules. */
  data class Body(
    val id: String,
    val footprint: Footprint,
    val isFloorCovering: Boolean,
    val isWallMounted: Boolean = false,
  )

  data class Wall(val id: String, val segment: Segment)

  enum class BlockReason(val jsName: String) { WALL("wall"), ITEM("item") }

  fun collides(a: Footprint, b: Footprint, margin: Float = DEFAULT_MARGIN_M): Boolean =
    heightsOverlap(a, b, margin) && convexOverlap(a.corners(), b.corners(), margin)

  private fun heightsOverlap(a: Footprint, b: Footprint, margin: Float): Boolean =
    !(a.bottom - b.top > margin || b.bottom - a.top > margin)

  /**
   * Whether [wall] is the one a wall item with this footprint hangs on: parallel to its back
   * edge and within [HOST_WALL_DISTANCE_M] of it. The back edge is the footprint's -Z side.
   */
  fun isHostWall(item: Footprint, wall: Segment): Boolean {
    val dir = normalize(wall.x2 - wall.x1, wall.z2 - wall.z1) ?: return false
    val f = item.forward()
    // Parallel to the back edge = perpendicular to the item's forward direction.
    if (abs(dir.x * f.x + dir.z * f.z) > HOST_WALL_MAX_SIN) return false
    val backX = item.x - f.x * item.depth / 2f
    val backZ = item.z - f.z * item.depth / 2f
    val distance = abs((backX - wall.x1) * dir.z - (backZ - wall.z1) * dir.x)
    return distance <= HOST_WALL_DISTANCE_M
  }

  fun collides(item: Footprint, wall: Segment, margin: Float = DEFAULT_MARGIN_M): Boolean =
    convexOverlap(item.corners(), wall.points(), margin)

  /**
   * Whether [moving] may go to [candidate]. Returns the reason it is blocked, or null.
   *
   * Only obstacles the move *newly* hits block it: obstacles that [current] already overlaps
   * (e.g. a wall detected after placement) are ignored, so the user can drag the item out.
   * Walls take priority over items. Wall-mounted items ignore their host wall.
   */
  fun blockedReason(
    moving: Body,
    candidate: Footprint,
    current: Footprint?,
    others: List<Body>,
    walls: List<Wall>,
    margin: Float = DEFAULT_MARGIN_M,
  ): BlockReason? {
    fun newlyHitsWall(wall: Wall): Boolean {
      if (moving.isWallMounted && isHostWall(candidate, wall.segment)) return false
      return collides(candidate, wall.segment, margin) && (current == null || !collides(current, wall.segment, margin))
    }

    fun newlyHitsItem(other: Body): Boolean {
      if (other.id == moving.id) return false
      // Rugs ignore everything but other rugs (furniture stands on them, art hangs above).
      if (other.isFloorCovering != moving.isFloorCovering) return false
      return collides(candidate, other.footprint, margin) &&
        (current == null || !collides(current, other.footprint, margin))
    }

    if (walls.any(::newlyHitsWall)) return BlockReason.WALL
    if (others.any(::newlyHitsItem)) return BlockReason.ITEM
    return null
  }

  /**
   * SAT for two convex point sets (a polygon or a segment). They "collide" unless some axis
   * separates their projections by more than [margin]. Axes: the edge normals of both shapes;
   * for a segment, also its own direction (covers its end caps).
   */
  private fun convexOverlap(a: List<Vec2>, b: List<Vec2>, margin: Float): Boolean {
    for (axis in axes(a) + axes(b)) {
      val (aMin, aMax) = project(a, axis)
      val (bMin, bMax) = project(b, axis)
      val gap = maxOf(bMin - aMax, aMin - bMax)
      if (gap > margin) return false
    }
    return true
  }

  private fun axes(points: List<Vec2>): List<Vec2> {
    if (points.size == 2) {
      val d = normalize(points[1].x - points[0].x, points[1].z - points[0].z) ?: return emptyList()
      return listOf(d, Vec2(-d.z, d.x))
    }
    return points.indices.mapNotNull { i ->
      val p = points[i]
      val q = points[(i + 1) % points.size]
      normalize(-(q.z - p.z), q.x - p.x)
    }
  }

  private fun project(points: List<Vec2>, axis: Vec2): Pair<Float, Float> {
    var min = Float.POSITIVE_INFINITY
    var max = Float.NEGATIVE_INFINITY
    for (p in points) {
      val d = p.x * axis.x + p.z * axis.z
      if (d < min) min = d
      if (d > max) max = d
    }
    return min to max
  }

  private fun normalize(x: Float, z: Float): Vec2? {
    val len = sqrt(x * x + z * z)
    return if (!(len >= 1e-6f)) null else Vec2(x / len, z / len) // also rejects NaN
  }
}
