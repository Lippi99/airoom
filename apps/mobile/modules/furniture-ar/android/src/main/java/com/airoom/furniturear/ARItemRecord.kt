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
}

/** Real-world size in meters. */
class ARItemDimensions : Record {
  @Field val width: Double = 0.0
  @Field val depth: Double = 0.0
  @Field val height: Double = 0.0
}
