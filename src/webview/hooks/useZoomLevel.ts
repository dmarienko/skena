/**
 * useZoomLevel — reads the current discrete zoom level from ZoomLevelContext.
 *
 * The single useOnViewportChange listener lives in ZoomLevelProvider
 * (rendered once at canvas level). Node components import this hook to
 * get the level without each registering their own viewport listener.
 */

export { useZoomLevel } from '../context/ZoomLevelContext';
