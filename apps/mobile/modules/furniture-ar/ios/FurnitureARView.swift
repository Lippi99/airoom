import ExpoModulesCore

/// Placeholder until the RealityKit implementation (roadmap step 4).
/// Declares every event of the contract so the JS side behaves the same on both platforms.
class FurnitureARView: ExpoView {
  let onTrackingStateChanged = EventDispatcher()
  let onPlaneDetected = EventDispatcher()
  let onItemPlaced = EventDispatcher()
  let onItemSelected = EventDispatcher()
  let onPlacementBlocked = EventDispatcher()
  let onItemTapped = EventDispatcher()
  let onError = EventDispatcher()

  var showPlaneOverlay = true

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = .black
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard window != nil else { return }
    onTrackingStateChanged(["state": "notAvailable"])
    onError(["code": "AR_UNAVAILABLE", "message": "AR on iOS is not available yet."])
  }
}
