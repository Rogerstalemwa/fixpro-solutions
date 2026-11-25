import { useEffect, useState } from 'react';
import { apiBlob } from '../lib/api.js';

// Photos and videos behind sign-in: fetched with the user's session, then shown from memory.
export default function PrivateMedia({ kind, id, alt = '', video = false, className = '' }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    let objectUrl;
    apiBlob(`/files/${kind}/${id}`).then((blob) => { objectUrl = URL.createObjectURL(blob); if (live) setUrl(objectUrl); }).catch(() => live && setFailed(true));
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [kind, id]);
  if (failed) return <div className={`${className} grid place-items-center bg-white/5 text-xs text-mist`}>Could not load</div>;
  if (!url) return <div className={`${className} animate-pulse bg-white/10`} aria-hidden="true" />;
  return video ? <video src={url} controls className={className} /> : <img src={url} alt={alt} className={className} />;
}
