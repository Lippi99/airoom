package com.airoom.furniturear

import com.google.ar.core.ArCoreApk
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Android side of the `furniture-ar` contract (see src/FurnitureAR.types.ts). */
class FurnitureARModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FurnitureAR")

    AsyncFunction("isSupported") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      // checkAvailability can answer UNKNOWN_CHECKING while it queries Play Services; retry briefly.
      Thread {
        var availability = ArCoreApk.getInstance().checkAvailability(context)
        var attempts = 0
        while (availability.isTransient && attempts < 20) {
          Thread.sleep(150)
          availability = ArCoreApk.getInstance().checkAvailability(context)
          attempts++
        }
        // SUPPORTED_NOT_INSTALLED / APK_TOO_OLD count as supported: ARCore is installed on demand.
        promise.resolve(availability.isSupported)
      }.start()
    }

    View(FurnitureARView::class) {
      Events(
        "onTrackingStateChanged",
        "onPlaneDetected",
        "onItemPlaced",
        "onItemSelected",
        "onPlacementBlocked",
        "onItemTapped",
        "onItemRemoved",
        "onError",
      )

      Prop("showPlaneOverlay") { view: FurnitureARView, show: Boolean ->
        view.setShowPlaneOverlay(show)
      }

      AsyncFunction("placeItem") { view: FurnitureARView, item: ARItemRecord, promise: Promise ->
        view.placeItem(item, promise)
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("removeItem") { view: FurnitureARView, instanceId: String, promise: Promise ->
        view.removeItem(instanceId, promise)
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("clearScene") { view: FurnitureARView, promise: Promise ->
        view.clearScene(promise)
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("captureSnapshot") { view: FurnitureARView, promise: Promise ->
        view.captureSnapshot(promise)
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("getPlacedItems") { view: FurnitureARView, promise: Promise ->
        view.getPlacedItems(promise)
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("hostItemAnchor") { view: FurnitureARView, instanceId: String, promise: Promise ->
        view.hostItemAnchor(instanceId, promise)
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("resolveCloudAnchor") { view: FurnitureARView, cloudAnchorId: String, promise: Promise ->
        view.resolveCloudAnchor(cloudAnchorId, promise)
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("stopResolvingCloudAnchors") { view: FurnitureARView, promise: Promise ->
        view.stopResolvingCloudAnchors(promise)
      }.runOnQueue(Queues.MAIN)

      OnViewDestroys { view: FurnitureARView ->
        view.destroy()
      }
    }
  }
}
