package com.airoom.furniturear

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** Mirrors `ARItem` in src/FurnitureAR.types.ts. */
class ARItemRecord : Record {
  @Field val instanceId: String = ""
  @Field val productId: String = ""
  @Field val category: String = ""
  @Field val glbUrl: String = ""
  @Field val usdzUrl: String = ""
  @Field val dimensions: ARItemDimensions = ARItemDimensions()
  /** Place at this world pose instead of aiming (rebuilding a saved scene). */
  @Field val pose: ARPoseRecord? = null
  /** Place on (and keep following) this resolved cloud anchor; takes precedence over [pose]. */
  @Field val cloudAnchorId: String? = null
}

/** Mirrors `ARPose`: world meters, yaw in radians around +Y. */
class ARPoseRecord : Record {
  @Field val x: Double = 0.0
  @Field val y: Double = 0.0
  @Field val z: Double = 0.0
  @Field val yaw: Double = 0.0
}

/** Real-world size in meters. */
class ARItemDimensions : Record {
  @Field val width: Double = 0.0
  @Field val depth: Double = 0.0
  @Field val height: Double = 0.0
}
