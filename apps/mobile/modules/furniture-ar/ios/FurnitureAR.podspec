Pod::Spec.new do |s|
  s.name           = 'FurnitureAR'
  s.version        = '0.1.0'
  s.summary        = 'AR furniture placement view (RealityKit + ARKit)'
  s.description    = 'Native AR view for placing real-scale furniture models. Contract: src/FurnitureAR.types.ts'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
