export function findDuplicateCameras(cameraDocument, options = {}) {
  const { highwayId = null } = options;
  const cameras = cameraDocument?.cameras ?? [];

  // Group by streamUrl (exact string match)
  const byStreamUrl = new Map();
  for (const camera of cameras) {
    const url = camera.streamUrl?.trim();
    if (!url) continue;

    if (!byStreamUrl.has(url)) {
      byStreamUrl.set(url, []);
    }
    byStreamUrl.get(url).push(camera);
  }

  const duplicates = [];
  for (const [streamUrl, list] of byStreamUrl.entries()) {
    if (list.length < 2) continue;

    // Filter by highwayId if specified (if any camera in the duplicate group belongs to highwayId)
    if (highwayId && !list.some((c) => c.highwayId === highwayId)) {
      continue;
    }

    // Retain first camera (older/original), mark rest as duplicates
    const originalCamera = list[0];
    for (let index = 1; index < list.length; index += 1) {
      const duplicateCamera = list[index];
      if (highwayId && duplicateCamera.highwayId !== highwayId && originalCamera.highwayId !== highwayId) {
        continue;
      }
      duplicates.push({
        duplicateCamera: {
          id: duplicateCamera.id,
          providerCameraId: duplicateCamera.providerCameraId,
          name: duplicateCamera.name,
          highwayId: duplicateCamera.highwayId,
          km: duplicateCamera.km,
          side: duplicateCamera.side,
          enabled: duplicateCamera.enabled,
          curationStatus: duplicateCamera.curationStatus,
        },
        originalCamera: {
          id: originalCamera.id,
          providerCameraId: originalCamera.providerCameraId,
          name: originalCamera.name,
          highwayId: originalCamera.highwayId,
          km: originalCamera.km,
          side: originalCamera.side,
          enabled: originalCamera.enabled,
          curationStatus: originalCamera.curationStatus,
        },
        streamUrl,
      });
    }
  }

  return {
    highwayId,
    totalDuplicates: duplicates.length,
    duplicates,
  };
}

export function bulkDeleteCameras(cameraDocument, cameraIds) {
  if (!Array.isArray(cameraIds) || cameraIds.length === 0) {
    return { document: cameraDocument, deletedCount: 0 };
  }

  const idsToDelete = new Set(cameraIds);
  const initialCameras = cameraDocument?.cameras ?? [];
  const remainingCameras = initialCameras.filter((camera) => !idsToDelete.has(camera.id));
  const deletedCount = initialCameras.length - remainingCameras.length;

  return {
    document: {
      ...cameraDocument,
      cameras: remainingCameras,
    },
    deletedCount,
  };
}
