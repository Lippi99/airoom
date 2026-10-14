package com.airoom.furniturear

import com.google.android.filament.MaterialInstance
import com.google.ar.core.Trackable
import io.github.sceneview.ar.node.AnchorNode
import io.github.sceneview.node.CubeNode
import io.github.sceneview.node.ModelNode
import io.github.sceneview.node.Node
import io.github.sceneview.node.PlaneNode

/**
 * One placed copy of a product.
 *
 * Scene graph:
 * ```
 * AnchorNode (ARCore anchor on the floor or wall plane, world-aligned: translation only)
 *  └─ pivot            (drag offset + yaw around Y)
 *      ├─ footprint    (selection / blocked highlight: a flat box on the floor, or for wall
 *      │                items a thin panel on the wall, slightly larger than the item)
 *      ├─ contactShadow (soft procedural shadow: on the floor, or on the wall behind)
 *      └─ ModelNode    (real scale; bottom-center at the pivot origin, or for wall items
 *                       the center of its back face)
 * ```
 */
internal class PlacedItem(
  val instanceId: String,
  val productId: String,
  val category: String,
  val width: Float,
  val depth: Float,
  val height: Float,
  val anchorNode: AnchorNode,
  val pivot: Node,
  val footprint: CubeNode,
  val contactShadow: PlaneNode,
  val contactShadowMaterial: MaterialInstance,
  /** Hangs on a wall (wall art): faces out of the wall along +Z, never rotates. */
  val isWallMounted: Boolean,
) {
  var modelNode: ModelNode? = null

  /**
   * What the item's anchor is attached to, re-used when it is re-anchored: the floor or wall
   * plane, or for plain walls without a detected plane the depth/feature point it was hung on.
   */
  var hostPlane: Trackable? = null

  /** Rotation around +Y, radians (counter-clockwise seen from above). */
  var yawRadians: Float = 0f

  /** True until the model is downloaded and attached. */
  val isLoading get() = modelNode == null
}
