// The live page's settings. The values in the repository are PLACEHOLDERS — never commit a real
// token here. tools/publish_site.sh fills the published copy from ~/.cvfr-secrets/live-web.env
// (tools/live/write_config.py; the owner's setup: docs/research/live-sharing.md "Owner's setup").
// Both tokens are public by design (any web page's tokens are); their origins limit where they work.
window.CVFR_LIVE_CONFIG = {
  container: "iCloud.com.arielfeldman.cvfrnav",
  environment: "production",
  // CloudKit Console → the container → Tokens & Keys → API token (Allowed Origins: the page's).
  cloudKitAPIToken: "5b5f8b9c635985e07158980ae7a73b38117d4e494decd7da92934a0df440ba63",
  // MapKit JS tokens, one per origin the page is served from (a token's origin claim is one origin).
  mapkitTokens: {
    "https://live.cvfr.idra-tech.io": "eyJhbGciOiJFUzI1NiIsImtpZCI6IjNBMlhBR0Y0U0wiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJXM1E0SFUyUUY1IiwiaWF0IjoxNzkzNDAyMzY3LCJleHAiOjE4MjQ5MzgzNjcsIm9yaWdpbiI6Imh0dHBzOi8vbGl2ZS5jdmZyLmlkcmEtdGVjaC5pbyJ9.1MY_92nkDWZZmRLySCvPY-q3zbIKq5fFcFBrQ02LGSltM-ry0pjNWwYLpu87l1_zj476MFELoNvCKsGkMqtOjg",
    "https://cvfr.idra-tech.io": "eyJhbGciOiJFUzI1NiIsImtpZCI6IjNBMlhBR0Y0U0wiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJXM1E0SFUyUUY1IiwiaWF0IjoxNzkzNDAyMzY3LCJleHAiOjE4MjQ5MzgzNjcsIm9yaWdpbiI6Imh0dHBzOi8vY3Zmci5pZHJhLXRlY2guaW8ifQ.qS7CvQ8iZnxkfNINShYaCwVMKbVYbfebJclpNqCvfBaRSuuqR7wIsQVb5RSusYHczs2viwU7Ti4gGmHBbTNIQw"
  },
  pollSeconds: 15,
  // The app's App Store page (live-web.env APP_STORE_URL, "https://apps.apple.com/app/id<Apple ID>").
  // Empty while the app is on TestFlight only: the page's logo then opens the support site.
  appStoreURL: ""
};
