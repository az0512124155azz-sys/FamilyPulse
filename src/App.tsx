import { useEffect, useMemo, useRef, useState } from 'react';
import { deleteUser, onAuthStateChanged, signOut } from 'firebase/auth';
import {
  collection, deleteDoc, doc, getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc
} from 'firebase/firestore';
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { Baby, Copy, LocateFixed, MapPin, Plus, ShieldCheck, Smartphone, Users, Maximize2, Settings, X, Home } from 'lucide-react';
import { auth, db, ensureAuth, firebaseReady } from './firebase';
import { divIcon, icon, latLngBounds } from 'leaflet';
import { prepareProfilePhoto } from './profilePhoto';

type Role='parent'|'child';
type Profile={uid:string;name:string;photoURL?:string;role:Role;code:string;familyId?:string};
type Member={uid:string;name:string;photoURL?:string;role:Role;inviteCode?:string;active?:boolean;disconnectedAt?:{seconds:number};homeStatus?:'inside'|'outside';homeStatusUpdatedAt?:{seconds:number}};
type Location={lat:number;lng:number;accuracy:number;familyId:string;updatedAt?:{seconds:number};source?:'fast'|'precise'};
type LogoutEvent={childUid:string;name:string;photoURL?:string;familyId:string;loggedOutAt?:{seconds:number};lat?:number;lng?:number;accuracy?:number;hasLocation:boolean};
type Presence={online:boolean;lastSeen?:{seconds:number};familyId?:string};
type HomeConfig={lat:number;lng:number;radiusMeters:number;updatedAt?:{seconds:number}};
type FamilyAlert={id:string;type:'exit_home'|'logout';childUid:string;childName:string;createdAt?:{seconds:number};lat?:number;lng?:number};
type GeocodeResult={place_id:number;display_name:string;lat:string;lon:string};

const randomCode=()=>Math.random().toString(36).slice(2,6).toUpperCase()+Math.random().toString(36).slice(2,6).toUpperCase();
const randomId=()=>crypto.randomUUID().replaceAll('-','').slice(0,20);

export default function App(){
  const [profile,setProfile]=useState<Profile|null>(null);
  const [loading,setLoading]=useState(true);
  const [setupRole,setSetupRole]=useState<Role|null>(null);
  const [name,setName]=useState('');
  const [photo,setPhoto]=useState<File|null>(null);
  const [joinCode,setJoinCode]=useState('');
  const [members,setMembers]=useState<Member[]>([]);
  const [selected,setSelected]=useState<Member|null>(null);
  const [locations,setLocations]=useState<Record<string,Location>>({});
  const [updating,setUpdating]=useState<Record<string,boolean>>({});
  const [fitSignal,setFitSignal]=useState(0);
  const [message,setMessage]=useState('');
  const [logoutEvents,setLogoutEvents]=useState<LogoutEvent[]>([]);
  const [presence,setPresence]=useState<Record<string,Presence>>({});
  const [home,setHome]=useState<HomeConfig|null>(null);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [alerts,setAlerts]=useState<FamilyAlert[]>([]);
  const [homeSearch,setHomeSearch]=useState('');
  const [homeSearchResults,setHomeSearchResults]=useState<GeocodeResult[]>([]);
  const [searchingHome,setSearchingHome]=useState(false);
  const [homeSearchError,setHomeSearchError]=useState('');
  const [homeDraft,setHomeDraft]=useState<{lat:number;lng:number;label?:string}|null>(null);
  const [soundReady,setSoundReady]=useState(false);
  const audioContextRef=useRef<AudioContext|null>(null);
  const audioKeepAliveRef=useRef<{osc:OscillatorNode;gain:GainNode}|null>(null);
  const requestStartedAt=useRef<Record<string,number>>({});
  const autoRequestedFamily=useRef<string>('');
  const children=useMemo(()=>members.filter(m=>m.role==='child' && m.active!==false),[members]);
  const parents=useMemo(()=>members.filter(m=>m.role==='parent'),[members]);

  useEffect(()=>{
    if(!firebaseReady){setLoading(false);return;}

    return onAuthStateChanged(auth,async user=>{
      try{
        if(!user){
          setProfile(null);
          setLoading(false);
          return;
        }

        const snap=await getDoc(doc(db,'users',user.uid));
        if(snap.exists() && snap.data()?.deleted!==true){
          setProfile({uid:user.uid,...snap.data()} as Profile);
        }else{
          setProfile(null);
        }
      }catch(err){
        console.error('Auth/profile bootstrap failed',err);
        setProfile(null);
      }finally{
        setLoading(false);
      }
    });
  },[]);

  useEffect(()=>{
    if(!profile?.familyId) return;

    return onSnapshot(collection(db,'families',profile.familyId,'members'),snap=>{
      const next=snap.docs.map(d=>d.data() as Member);
      setMembers(next);

      if(profile.role==='parent'){
        void Promise.allSettled(
          next
            .filter(member=>member.role==='child')
            .map(async child=>{
              if(child.active===false){
                setMembers(prev=>prev.filter(member=>member.uid!==child.uid));
                await Promise.allSettled([
                  deleteDoc(doc(db,'families',profile.familyId!,'members',child.uid)),
                  deleteDoc(doc(db,'childLinks',child.uid)),
                  deleteDoc(doc(db,'presence',child.uid)),
                  deleteDoc(doc(db,'locations',child.uid)),
                  deleteDoc(doc(db,'locationRequests',child.uid)),
                  deleteDoc(doc(db,'buzzerCommands',child.uid)),
                  deleteDoc(doc(db,'users',child.uid)),
                  ...(child.inviteCode?[deleteDoc(doc(db,'pairCodes',child.inviteCode))]:[])
                ]);
                setLocations(prev=>{
                  const copy={...prev};
                  delete copy[child.uid];
                  return copy;
                });
                setPresence(prev=>{
                  const copy={...prev};
                  delete copy[child.uid];
                  return copy;
                });
                if(selected?.uid===child.uid) setSelected(null);
                return;
              }

              if(child.inviteCode){
                const pair=await getDoc(doc(db,'pairCodes',child.inviteCode));
                if(!pair.exists() || pair.data()?.revoked===true){
                  setMembers(prev=>prev.filter(member=>member.uid!==child.uid));
                  await Promise.allSettled([
                    deleteDoc(doc(db,'families',profile.familyId!,'members',child.uid)),
                    deleteDoc(doc(db,'childLinks',child.uid)),
                    deleteDoc(doc(db,'presence',child.uid)),
                    deleteDoc(doc(db,'locations',child.uid)),
                    deleteDoc(doc(db,'locationRequests',child.uid)),
                    deleteDoc(doc(db,'buzzerCommands',child.uid)),
                    deleteDoc(doc(db,'users',child.uid)),
                    ...(child.inviteCode?[deleteDoc(doc(db,'pairCodes',child.inviteCode))]:[])
                  ]);
                  setLocations(prev=>{
                    const copy={...prev};
                    delete copy[child.uid];
                    return copy;
                  });
                  setPresence(prev=>{
                    const copy={...prev};
                    delete copy[child.uid];
                    return copy;
                  });
                  if(selected?.uid===child.uid) setSelected(null);
                }
              }
            })
        );
      }

      if(selected && !next.some(m=>m.uid===selected.uid && m.active!==false)){
        setSelected(null);
      }
    });
  },[profile?.familyId,profile?.role,selected?.uid]);

  useEffect(()=>{
    if(!profile?.familyId) return;

    return onSnapshot(doc(db,'families',profile.familyId),async snap=>{
      const data=snap.data() as {home?:HomeConfig}|undefined;
      if(data?.home){
        setHome({...data.home,radiusMeters:30});
        return;
      }

      try{
        const own=await getDoc(doc(db,'users',profile.uid));
        const ownHome=own.data()?.home as HomeConfig|undefined;
        setHome(ownHome?{...ownHome,radiusMeters:30}:null);
      }catch(err){
        console.warn('Could not load fallback home config',err);
        setHome(null);
      }
    });
  },[profile?.familyId,profile?.uid]);

  useEffect(()=>{
    if(profile?.role!=='parent' || !profile.familyId) return;
    return onSnapshot(collection(db,'families',profile.familyId,'alerts'),snap=>{
      const items=snap.docs
        .map(d=>({id:d.id,...d.data()} as FamilyAlert))
        .sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0))
        .slice(0,10);
      setAlerts(items);
    });
  },[profile?.role,profile?.familyId]);

  useEffect(()=>{
    if(profile?.role!=='parent' || !profile.familyId) return;
    return onSnapshot(collection(db,'families',profile.familyId,'logoutEvents'),snap=>{
      const events=snap.docs
        .map(d=>d.data() as LogoutEvent)
        .sort((a,b)=>(b.loggedOutAt?.seconds||0)-(a.loggedOutAt?.seconds||0))
        .slice(0,5);
      setLogoutEvents(events);
    });
  },[profile?.role,profile?.familyId]);

  useEffect(()=>{
    if(profile?.role!=='parent' || !profile.familyId || children.length===0) return;

    Promise.allSettled(children.map(child=>
      setDoc(doc(db,'childLinks',child.uid),{
        uid:child.uid,
        familyId:profile.familyId,
        linkedBy:profile.uid,
        linkedAt:serverTimestamp()
      },{merge:true})
    )).catch(()=>{});
  },[profile?.role,profile?.familyId,children.map(c=>c.uid).join('|')]);

  useEffect(()=>{
    if(!profile || profile.role!=='child') return;

    let stopped=false;
    let timer:number|undefined;

    const publishPresence=async()=>{
      try{
        const link=await getDoc(doc(db,'childLinks',profile.uid));
        let familyId=link.exists()?String(link.data().familyId||''):'';
        if(!familyId){
          const lastRequest=await getDoc(doc(db,'locationRequests',profile.uid));
          if(lastRequest.exists()) familyId=String(lastRequest.data().familyId||'');
        }

        if(familyId){
          localStorage.setItem('familypulse.familyId',familyId);
          await Promise.allSettled([
            setDoc(doc(db,'presence',profile.uid),{
              uid:profile.uid,
              familyId,
              online:true,
              lastSeen:serverTimestamp()
            },{merge:true}),
            setDoc(doc(db,'users',profile.uid),{familyId},{merge:true}),
            setDoc(doc(db,'pairCodes',profile.code),{familyId},{merge:true})
          ]);
        }
      }catch(err){
        console.warn('Presence update failed',err);
      }
    };

    publishPresence();
    timer=window.setInterval(()=>{ if(!stopped) publishPresence(); },30000);

    const onVisibility=()=>{ if(document.visibilityState==='visible') publishPresence(); };
    document.addEventListener('visibilitychange',onVisibility);

    return ()=>{
      stopped=true;
      if(timer) window.clearInterval(timer);
      document.removeEventListener('visibilitychange',onVisibility);
    };
  },[profile?.uid,profile?.role]);

  useEffect(()=>{
    if(!profile || profile.role!=='child') return;
    const reqRef=doc(db,'locationRequests',profile.uid);

    return onSnapshot(reqRef,async snap=>{
      const data=snap.data();
      if(!data || !data.familyId) return;

      if(data.buzzStatus==='requested' && data.buzzToken){
        try{
          const ctx=audioContextRef.current;
          if(!ctx) throw new Error('audio-not-enabled');
          if(ctx.state==='suspended'){
            await ctx.resume().catch(()=>{});
          }
          if(ctx.state!=='running') throw new Error('audio-not-enabled');

          setMessage('התקבל צפצוף מההורה — האזעקה תפעל עד דקה.');
          const vibrate=(navigator as Navigator & {vibrate?:(pattern:number|number[])=>boolean}).vibrate;
          vibrate?.call(navigator,[350,120,350,120,350,120,900,150,900]);

          await updateDoc(reqRef,{
            buzzStatus:'playing',
            buzzStartedAt:serverTimestamp()
          });

          await playAlarmTone(ctx,60);

          await updateDoc(reqRef,{
            buzzStatus:'completed',
            buzzCompletedAt:serverTimestamp()
          });

          setMessage('הצפצוף הסתיים.');
        }catch(err){
          console.error('Alarm playback failed',err);
          await updateDoc(reqRef,{
            buzzStatus:'failed',
            buzzCompletedAt:serverTimestamp()
          }).catch(()=>{});
          setMessage('התקבלה התראה, אבל הצליל חסום. לחץ על “הפעל צלילי התראה”.');
        }
      }

      if(data.status!=='requested') return;

      const getPosition=(options:PositionOptions)=>new Promise<GeolocationPosition>((resolve,reject)=>
        navigator.geolocation.getCurrentPosition(resolve,reject,options)
      );

      try{
        let sentFast=false;

        try{
          const fast=await getPosition({enableHighAccuracy:false,timeout:1500,maximumAge:300000});
          await setDoc(doc(db,'locations',profile.uid),{
            lat:fast.coords.latitude,
            lng:fast.coords.longitude,
            accuracy:fast.coords.accuracy,
            familyId:data.familyId,
            source:'fast',
            updatedAt:serverTimestamp()
          });
          sentFast=true;
          await updateDoc(reqRef,{status:'refining',fastCompletedAt:serverTimestamp()});
          setMessage('מיקום מהיר נשלח. משפר דיוק…');
        }catch(err){
          console.warn('Fast location unavailable',err);
        }

        try{
          const precise=await getPosition({enableHighAccuracy:true,timeout:8000,maximumAge:15000});
          await setDoc(doc(db,'locations',profile.uid),{
            lat:precise.coords.latitude,
            lng:precise.coords.longitude,
            accuracy:precise.coords.accuracy,
            familyId:data.familyId,
            source:'precise',
            updatedAt:serverTimestamp()
          });
          await updateDoc(reqRef,{status:'completed',completedAt:serverTimestamp()});
          setMessage('המיקום המדויק נשלח להורה.');
        }catch(err){
          if(sentFast){
            await updateDoc(reqRef,{status:'completed',completedAt:serverTimestamp()});
            setMessage('נשלח המיקום הזמין האחרון.');
          }else{
            throw err;
          }
        }
      }catch(err){
        console.error('Location request failed',err);
        await updateDoc(reqRef,{status:'failed',completedAt:serverTimestamp()});
        setMessage('לא ניתן לקבל מיקום. יש לאשר הרשאת מיקום בדפדפן.');
      }
    });
  },[profile]);



  useEffect(()=>{
    if(profile?.role!=='child') return;

    const resumeAudio=()=>{
      const ctx=audioContextRef.current;
      if(ctx && ctx.state==='suspended'){
        void ctx.resume().then(()=>setSoundReady(ctx.state==='running')).catch(()=>{});
      }
    };

    document.addEventListener('visibilitychange',resumeAudio);
    window.addEventListener('focus',resumeAudio);
    return ()=>{
      document.removeEventListener('visibilitychange',resumeAudio);
      window.removeEventListener('focus',resumeAudio);
    };
  },[profile?.role]);

  useEffect(()=>{
    if(profile?.role!=='parent' || children.length===0) return;

    const unsubs=children.map(child=>
      onSnapshot(doc(db,'presence',child.uid),snap=>{
        if(!snap.exists()) return;
        setPresence(prev=>({...prev,[child.uid]:snap.data() as Presence}));
      })
    );

    return ()=>unsubs.forEach(unsub=>unsub());
  },[profile?.role,children.map(c=>c.uid).join('|')]);

  useEffect(()=>{
    if(profile?.role!=='parent' || children.length===0) return;

    const unsubs=children.map(child=>
      onSnapshot(doc(db,'locations',child.uid),async snap=>{
        if(!snap.exists()) return;
        const next=snap.data() as Location;
        setLocations(prev=>({...prev,[child.uid]:next}));

        const started=requestStartedAt.current[child.uid]||0;
        const updatedMs=next.updatedAt?.seconds ? next.updatedAt.seconds*1000 : 0;
        if(started && updatedMs>=started-1500){
          setUpdating(prev=>({...prev,[child.uid]:false}));
        }

        if(profile?.familyId && home){
          const distance=distanceMeters(next.lat,next.lng,home.lat,home.lng);
          const newStatus:Member['homeStatus']=distance<=home.radiusMeters?'inside':'outside';

          if(child.homeStatus!==newStatus){
            await updateDoc(doc(db,'families',profile.familyId,'members',child.uid),{
              homeStatus:newStatus,
              homeStatusUpdatedAt:serverTimestamp()
            });

            if(child.homeStatus==='inside' && newStatus==='outside'){
              await setDoc(doc(db,'families',profile.familyId,'alerts',randomId()),{
                type:'exit_home',
                childUid:child.uid,
                childName:child.name,
                lat:next.lat,
                lng:next.lng,
                createdAt:serverTimestamp()
              });
            }
          }
        }
      })
    );

    return ()=>unsubs.forEach(unsub=>unsub());
  },[profile?.role,profile?.familyId,children.map(c=>`${c.uid}:${c.homeStatus||''}`).join('|'),home?.lat,home?.lng,home?.radiusMeters]);

  async function createProfile(){
    if(!setupRole || !name.trim()) return;

    setMessage('');
    setLoading(true);

    try{
      const user=await ensureAuth();

      let photoURL='';
      if(photo){
        try{
          photoURL=await prepareProfilePhoto(photo);
        }catch(err){
          console.error('Profile photo processing failed',err);
          setMessage('לא הצלחנו לעבד את התמונה. הפרופיל יישמר בלי תמונה.');
        }
      }

      const code=randomCode();
      let familyId:string|undefined;

      if(setupRole==='parent'){
        familyId=randomId();
        await setDoc(doc(db,'families',familyId),{
          createdAt:serverTimestamp(),
          ownerUid:user.uid
        });
        await setDoc(doc(db,'families',familyId,'members',user.uid),{
          uid:user.uid,
          name:name.trim(),
          photoURL,
          role:'parent'
        });
      }

      const p:Profile={
        uid:user.uid,
        name:name.trim(),
        photoURL,
        role:setupRole,
        code,
        ...(familyId ? { familyId } : {})
      };

      await setDoc(doc(db,'users',user.uid),p);
      await setDoc(doc(db,'pairCodes',code),{
        uid:user.uid,
        type:setupRole,
        familyId:familyId||null,
        name:p.name,
        photoURL:photoURL||'',
        createdAt:serverTimestamp()
      });

      setProfile(p);
    }catch(err){
      console.error('Profile creation failed',err);
      const detail=err instanceof Error ? err.message : '';
      setMessage(`שמירת הפרופיל נכשלה${detail ? `: ${detail}` : '.'}`);
    }finally{
      setLoading(false);
    }
  }

  async function connectCode(){
    if(!profile || !joinCode.trim()) return;
    const code=joinCode.trim().toUpperCase();
    const pair=await getDoc(doc(db,'pairCodes',code));
    if(!pair.exists()){setMessage('הקוד לא נמצא.');return;}
    const data=pair.data() as {uid:string;type:Role;familyId?:string;name:string;photoURL?:string};
    if(data.uid===profile.uid){setMessage('זה הקוד שלך.');return;}

    if(data.type==='child'){
      if(profile.role!=='parent' || !profile.familyId){setMessage('רק הורה יכול לצרף ילד.');return;}
      await setDoc(doc(db,'families',profile.familyId,'members',data.uid),{
        uid:data.uid,
        name:data.name,
        photoURL:data.photoURL||'',
        role:'child',
        inviteCode:code,
        active:true,
        connectedAt:serverTimestamp()
      },{merge:true});
      await setDoc(doc(db,'childLinks',data.uid),{
        uid:data.uid,
        familyId:profile.familyId,
        linkedBy:profile.uid,
        linkedAt:serverTimestamp()
      },{merge:true});
      setMessage(`${data.name} נוסף למשפחה.`);
    }else{
      if(profile.role!=='parent' || !data.familyId){setMessage('הקוד הזה אינו קוד שיתוף פעיל.');return;}
      await setDoc(doc(db,'families',data.familyId,'members',profile.uid),{
        uid:profile.uid,name:profile.name,photoURL:profile.photoURL||'',role:'parent',inviteCode:code
      });
      await updateDoc(doc(db,'users',profile.uid),{familyId:data.familyId});
      setProfile({...profile,familyId:data.familyId});
      setMessage('הצטרפת כשותף למשפחה.');
    }
    setJoinCode('');
  }

  async function enableAlertSound(){
    try{
      const AudioCtx=window.AudioContext || (window as typeof window & {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
      if(!AudioCtx) throw new Error('AudioContext unsupported');

      let ctx=audioContextRef.current;
      if(!ctx || ctx.state==='closed'){
        ctx=new AudioCtx({latencyHint:'interactive'});
        audioContextRef.current=ctx;
      }

      if(ctx.state==='suspended') await ctx.resume();

      // Keep the already-unlocked audio session alive while this page stays open.
      if(!audioKeepAliveRef.current){
        const keepGain=ctx.createGain();
        keepGain.gain.setValueAtTime(0.000001,ctx.currentTime);
        const keepOsc=ctx.createOscillator();
        keepOsc.type='sine';
        keepOsc.frequency.setValueAtTime(22,ctx.currentTime);
        keepOsc.connect(keepGain);
        keepGain.connect(ctx.destination);
        keepOsc.start();
        audioKeepAliveRef.current={osc:keepOsc,gain:keepGain};
      }

      setSoundReady(true);
      setMessage('צלילי ההתראה הופעלו. משמיע עכשיו בדיקת אזעקה של 8 שניות…');
      await playAlarmTone(ctx,8);
      setMessage('צלילי ההתראה פעילים. השאר את FamilyPulse פתוח כדי לקבל צפצוף מההורה.');
    }catch(err){
      console.error('Could not enable alert sound',err);
      setSoundReady(false);
      setMessage('לא הצלחנו להפעיל את הצליל. ודא שעוצמת המדיה גבוהה ונסה שוב.');
    }
  }

  async function getLogoutLocation(){
    const getPosition=(options:PositionOptions)=>new Promise<GeolocationPosition>((resolve,reject)=>
      navigator.geolocation.getCurrentPosition(resolve,reject,options)
    );
    try{
      return await getPosition({enableHighAccuracy:true,timeout:6000,maximumAge:30000});
    }catch{
      try{
        return await getPosition({enableHighAccuracy:false,timeout:1500,maximumAge:300000});
      }catch{
        return null;
      }
    }
  }

  async function deleteCurrentAuthAccount(){
    const current=auth.currentUser;
    if(!current) return true;

    try{
      await deleteUser(current);
      return true;
    }catch(sdkError){
      console.warn('Firebase SDK deleteUser failed; trying Identity Toolkit REST fallback',sdkError);
    }

    try{
      const idToken=await current.getIdToken(true);
      const apiKey=String(auth.app.options.apiKey||'');
      if(!apiKey) throw new Error('missing-api-key');

      const response=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${encodeURIComponent(apiKey)}`,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({idToken})
      });

      if(!response.ok){
        throw new Error(`Identity Toolkit delete failed: ${response.status}`);
      }

      await signOut(auth).catch(()=>{});
      return true;
    }catch(restError){
      console.error('Firebase Auth REST delete failed',restError);
      return false;
    }
  }

  async function logout(){
    if(profile?.role==='child'){
      setMessage('מנתק ומסיר את המשתמש…');

      let familyId=localStorage.getItem('familypulse.familyId')||'';

      try{
        if(!familyId){
          const link=await getDoc(doc(db,'childLinks',profile.uid));
          if(link.exists()) familyId=String(link.data().familyId||'');
        }

        if(!familyId){
          const lastRequest=await getDoc(doc(db,'locationRequests',profile.uid));
          if(lastRequest.exists()) familyId=String(lastRequest.data().familyId||'');
        }
      }catch(err){
        console.warn('Could not resolve family during logout',err);
      }

      const pos=familyId?await getLogoutLocation():null;

      if(familyId){
        // Old production rules already permit the child to update its own member document.
        // This is the critical write that removes the child from the parent's UI immediately.
        try{
          await updateDoc(doc(db,'families',familyId,'members',profile.uid),{
            active:false,
            disconnectedAt:serverTimestamp()
          });
        }catch(err){
          console.error('Could not mark family member inactive',err);
        }

        // Revoke/tombstone records using writes that older rules allow.
        await Promise.allSettled([
          setDoc(doc(db,'pairCodes',profile.code),{
            uid:profile.uid,
            type:'child',
            name:profile.name,
            photoURL:profile.photoURL||'',
            revoked:true,
            revokedAt:serverTimestamp()
          },{merge:true}),
          setDoc(doc(db,'users',profile.uid),{
            uid:profile.uid,
            name:profile.name,
            photoURL:profile.photoURL||'',
            role:'child',
            code:profile.code,
            deleted:true,
            deletedAt:serverTimestamp()
          },{merge:true}),
          setDoc(doc(db,'presence',profile.uid),{
            uid:profile.uid,
            familyId,
            online:false,
            lastSeen:serverTimestamp()
          },{merge:true}),
          setDoc(doc(db,'families',familyId,'logoutEvents',`${profile.uid}-${Date.now()}`),{
            childUid:profile.uid,
            name:profile.name,
            photoURL:profile.photoURL||'',
            familyId,
            hasLocation:Boolean(pos),
            ...(pos?{
              lat:pos.coords.latitude,
              lng:pos.coords.longitude,
              accuracy:pos.coords.accuracy
            }:{}),
            loggedOutAt:serverTimestamp()
          })
        ]);

        // Full cleanup succeeds once the repository rules are also published in Firebase.
        await Promise.allSettled([
          deleteDoc(doc(db,'families',familyId,'members',profile.uid)),
          deleteDoc(doc(db,'childLinks',profile.uid)),
          deleteDoc(doc(db,'presence',profile.uid)),
          deleteDoc(doc(db,'locations',profile.uid)),
          deleteDoc(doc(db,'locationRequests',profile.uid)),
          deleteDoc(doc(db,'buzzerCommands',profile.uid)),
          deleteDoc(doc(db,'pairCodes',profile.code)),
          deleteDoc(doc(db,'users',profile.uid))
        ]);
      }else{
        // Even without a family link, revoke the child's own account/profile.
        await Promise.allSettled([
          setDoc(doc(db,'pairCodes',profile.code),{
            uid:profile.uid,
            type:'child',
            revoked:true,
            revokedAt:serverTimestamp()
          },{merge:true}),
          setDoc(doc(db,'users',profile.uid),{
            uid:profile.uid,
            role:'child',
            code:profile.code,
            deleted:true,
            deletedAt:serverTimestamp()
          },{merge:true})
        ]);
      }

      localStorage.removeItem('familypulse.familyId');
      setProfile(null);
      setMembers([]);
      setLocations({});
      setPresence({});

      const authDeleted=await deleteCurrentAuthAccount();
      if(!authDeleted){
        // The UI is already disconnected, but make the failure explicit instead of silently hiding it.
        setMessage('המשתמש הוסר מהמשפחה, אבל מחיקת Firebase Authentication נכשלה. יש לפרסם את חוקי Firebase המעודכנים ולנסות שוב.');
        await signOut(auth).catch(()=>{});
      }else{
        setMessage('');
      }
      return;
    }

    try{
      await signOut(auth);
      setProfile(null);
    }catch(err){
      console.error('Parent sign out failed',err);
      setMessage('ההתנתקות נכשלה. נסה שוב.');
    }
  }

  async function sendBuzz(child:Member,testNow=false){
    if(!profile?.familyId) return;

    if(!testNow && !canBuzzNow()){
      setMessage('אפשר לצפצף לילד רק בימים ראשון–חמישי בין 08:10 ל־09:00.');
      return;
    }

    if(!testNow && child.homeStatus!=='inside'){
      setMessage('אפשרות הצפצוף זמינה רק לילד שמסומן כרגע בבית.');
      return;
    }

    const question=testNow
      ? `לשלוח עכשיו צפצוף בדיקה של עד דקה לטלפון של ${child.name}?`
      : `אתה בטוח שאתה רוצה לצפצף לטלפון של ${child.name}?`;
    if(!window.confirm(question)) return;

    try{
      await setDoc(doc(db,'locationRequests',child.uid),{
        childUid:child.uid,
        familyId:profile.familyId,
        requestedBy:profile.uid,
        buzzToken:randomId(),
        buzzStatus:'requested',
        buzzTest:testNow,
        buzzRequestedAt:serverTimestamp()
      },{merge:true});

      setMessage(`הצפצוף נשלח ל־${child.name}. FamilyPulse צריך להיות פתוח במכשיר הילד וצלילי ההתראה צריכים להיות פעילים.`);
    }catch(err){
      console.error('Buzz request failed',err);
      setMessage('שליחת הצפצוף נכשלה. רענן את הדף ונסה שוב.');
    }
  }

  async function searchHomeAddress(){
    const query=homeSearch.trim();
    if(!query) return;

    setSearchingHome(true);
    setHomeSearchError('');
    try{
      const url=`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=he&q=${encodeURIComponent(query)}`;
      const response=await fetch(url,{headers:{Accept:'application/json'}});
      if(!response.ok) throw new Error(`HTTP ${response.status}`);
      const results=await response.json() as GeocodeResult[];
      setHomeSearchResults(results);
      if(results.length===0) setHomeSearchError('לא נמצאו תוצאות. נסה לכתוב רחוב, מספר ועיר.');
    }catch(err){
      console.error('Home address search failed',err);
      setHomeSearchError('חיפוש הכתובת נכשל. אפשר עדיין לבחור בית מהמפה או להשתמש במיקום שלי.');
    }finally{
      setSearchingHome(false);
    }
  }

  async function useMyLocationForHome(){
    setHomeSearchError('');
    if(!navigator.geolocation){
      setHomeSearchError('הדפדפן הזה לא תומך במיקום.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      pos=>setHomeDraft({lat:pos.coords.latitude,lng:pos.coords.longitude,label:'המיקום שלי'}),
      ()=>setHomeSearchError('לא הצלחנו לקבל את המיקום שלך. בדוק שהרשאת המיקום מאושרת.'),
      {enableHighAccuracy:true,timeout:10000,maximumAge:15000}
    );
  }

  async function saveHome(){
    if(!profile?.familyId || !homeDraft) return;

    const savedHome={
      lat:homeDraft.lat,
      lng:homeDraft.lng,
      radiusMeters:30,
      updatedAt:serverTimestamp()
    };

    try{
      // This path works with the original production rules because users can update their own profile.
      await setDoc(doc(db,'users',profile.uid),{home:savedHome},{merge:true});

      // Keep trying to share the home at family level too; failure here must not break the feature.
      await setDoc(doc(db,'families',profile.familyId),{home:savedHome},{merge:true})
        .catch(err=>console.warn('Family home sync blocked by current Firestore rules',err));

      setHome({lat:homeDraft.lat,lng:homeDraft.lng,radiusMeters:30});
      setHomeSearchError('');
      setMessage('הבית נשמר בהצלחה.');
      setSettingsOpen(false);
    }catch(err){
      console.error('Saving home failed',err);
      setHomeSearchError('שמירת הבית נכשלה. נסה לרענן את הדף ולשמור שוב.');
    }
  }

  async function requestLocation(child:Member,focus=true){
    if(!profile?.familyId) return;
    if(focus) setSelected(child);

    requestStartedAt.current[child.uid]=Date.now();
    setUpdating(prev=>({...prev,[child.uid]:true}));

    await setDoc(doc(db,'locationRequests',child.uid),{
      childUid:child.uid,
      requestedBy:profile.uid,
      familyId:profile.familyId,
      status:'requested',
      requestedAt:serverTimestamp()
    });
  }

  useEffect(()=>{
    if(profile?.role!=='parent' || !profile.familyId || children.length===0) return;
    if(autoRequestedFamily.current===profile.familyId) return;

    autoRequestedFamily.current=profile.familyId;
    setMessage('מעדכן את המיקום של כל הילדים…');

    Promise.allSettled(children.map(child=>requestLocation(child,false)))
      .finally(()=>setMessage(''));
  },[profile?.role,profile?.familyId,children.map(c=>c.uid).join('|')]);

  if(loading) return <Center><div className="loader"/><p>טוען את FamilyPulse…</p></Center>;
  if(!firebaseReady) return <Center><Logo/><h1>FamilyPulse</h1><p>יש להגדיר את משתני Firebase לפי הקובץ <b>.env.example</b>.</p></Center>;

  if(!profile) return <div className="onboarding">
    <Logo/><h1>FamilyPulse</h1><p className="lead">המשפחה שלך, כשבאמת צריך לדעת איפה כולם.</p>
    {!setupRole?<div className="roleGrid">
      <button className="roleCard" onClick={()=>setSetupRole('parent')}><ShieldCheck/><b>אני הורה</b><span>צפייה בילדים והוספת הורה שותף</span></button>
      <button className="roleCard" onClick={()=>setSetupRole('child')}><Baby/><b>אני ילד/ה</b><span>מקבלים קוד ומאשרים מיקום לפי דרישה</span></button>
    </div>:<div className="setupCard">
      <button className="back" onClick={()=>setSetupRole(null)}>חזרה</button>
      <h2>{setupRole==='parent'?'יצירת פרופיל הורה':'יצירת פרופיל ילד/ה'}</h2>
      <label>איך קוראים לך?</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="שם פרטי"/>
      <label>תמונה</label><input type="file" accept="image/*" onChange={e=>setPhoto(e.target.files?.[0]||null)}/>
      <button className="primary" disabled={!name.trim()} onClick={createProfile}>המשך</button>
      {message&&<div className="toast">{message}</div>}
    </div>}
  </div>;

  if(profile.role==='child') return <div className="childPage">
    <TopBar profile={profile} onLogout={logout}/>
    <main className="childMain">
      <div className="pulseOrb"><MapPin/></div>
      <h1>הכול מחובר</h1>
      <p>אין צורך להשאיר GPS פעיל כל הזמן. כשהורה מבקש מיקום בזמן שהאפליקציה פתוחה, FamilyPulse מקבל נקודה עדכנית ושולח אותה.</p>
      <CodeCard code={profile.code} title="קוד החיבור שלך"/>
      <div className={soundReady?'soundSetup ready':'soundSetup'}>
        <Smartphone/>
        <div className="grow">
          <b>{soundReady?'צלילי התראה פעילים':'הפעל צלילי התראה'}</b>
          <span>{soundReady?'המכשיר מוכן לקבל צפצוף כל עוד FamilyPulse פתוח.':'צריך ללחוץ פעם אחת כדי שהדפדפן יאשר השמעת צפצופים.'}</span>
        </div>
        <button className="primary compact" onClick={()=>void enableAlertSound()}>{soundReady?'בדוק צליל':'הפעל עכשיו'}</button>
      </div>
      <div className="infoBox"><Smartphone/><span>באייפון, אם ה־PWA סגור לגמרי, האתר לא יכול להפעיל GPS או צליל ברקע באופן אמין.</span></div>
      {message&&<div className="toast">{message}</div>}
    </main>
  </div>;

  return <div className="appShell">
    <TopBar profile={profile} onLogout={logout} onSettings={()=>{setHomeDraft(home?{lat:home.lat,lng:home.lng,label:'בית'}:null);setSettingsOpen(true);}}/>
    <main className="dashboard">
      <section className="hero"><div><span className="eyebrow">המשפחה שלי</span><h1>שלום, {profile.name}</h1><p>{children.length} ילדים · {parents.length} הורים מחוברים</p></div><div className="avatar big">{profile.photoURL?<img src={profile.photoURL}/>:profile.name[0]}</div></section>

      {logoutEvents.length>0&&<section className="logoutNotices">
        <div className="sectionTitle"><h2>התנתקויות אחרונות</h2><span>{logoutEvents.length}</span></div>
        <div className="logoutNoticeList">
          {logoutEvents.map(event=><article className="logoutNotice" key={`${event.childUid}-${event.loggedOutAt?.seconds||0}`}>
            <div className="avatar">{event.photoURL?<img src={event.photoURL}/>:event.name[0]}</div>
            <div className="grow">
              <b>{event.name} התנתק מ־FamilyPulse</b>
              <span>{event.loggedOutAt?locationAge(event.loggedOutAt):'עכשיו'}</span>
              {event.hasLocation&&typeof event.lat==='number'&&typeof event.lng==='number'
                ? <small>מיקום אחרון: {event.lat.toFixed(5)}, {event.lng.toFixed(5)}{typeof event.accuracy==='number'?` · דיוק כ־${Math.round(event.accuracy)} מ׳`:''}</small>
                : <small>לא התקבל מיקום אחרון בזמן ההתנתקות.</small>}
            </div>
          </article>)}
        </div>
      </section>}

      {alerts.length>0&&<section className="alertsPanel">
        <div className="sectionTitle"><h2>התראות</h2><span>{alerts.length}</span></div>
        <div className="alertList">
          {alerts.map(alert=><article className="familyAlert" key={alert.id}>
            <div className="grow">
              <b>{alert.type==='exit_home'?`${alert.childName} יצא מהבית`:`${alert.childName} התנתק`}</b>
              <span>{alert.createdAt?locationAge(alert.createdAt):'עכשיו'}</span>
            </div>
            {typeof alert.lat==='number'&&typeof alert.lng==='number'&&
              <button className="locate" onClick={()=>window.open(`https://www.google.com/maps?q=${alert.lat},${alert.lng}`,'_blank','noopener,noreferrer')}>
                <MapPin/> מיקום
              </button>}
          </article>)}
        </div>
      </section>}

      <section className="connectPanel">
        <div><h2><Plus/> הוספת ילד או הורה</h2><p>הקלד קוד. FamilyPulse מזהה אוטומטית אם זה ילד או הורה שותף.</p></div>
        <div className="codeInput"><input value={joinCode} onChange={e=>setJoinCode(e.target.value.toUpperCase())} maxLength={8} placeholder="AB12CD34"/><button onClick={connectCode}>חבר</button></div>
        {message&&<div className="toast">{message}</div>}
      </section>
      <section><div className="sectionTitle"><h2>הילדים</h2><span>{children.length}</span></div>
        {children.length===0?<div className="empty"><Baby/><h3>עוד אין ילדים מחוברים</h3><p>פתח FamilyPulse במכשיר הילד והקלד כאן את הקוד שלו.</p></div>:
        <div className="childrenGrid">{children.map(child=>{
          const childLocation=locations[child.uid];
          return <article className={selected?.uid===child.uid?'childCard active':'childCard'} key={child.uid} onClick={()=>setSelected(child)}>
            <div className="avatar">{child.photoURL?<img src={child.photoURL}/>:child.name[0]}</div>
            <div className="grow">
              <b>{child.name}</b>
              <span>{updating[child.uid]?'מעדכן מיקום…':childLocation?locationAge(childLocation.updatedAt):'אין עדיין מיקום'}</span>
              <small className={isPresenceOnline(presence[child.uid])?'presenceOnline':'presenceOffline'}>
                {presenceText(presence[child.uid])}
              </small>
              {childLocation&&<small>דיוק כ־{Math.round(childLocation.accuracy)} מ׳ · {childLocation.source==='precise'?'מדויק':'מהיר'}</small>}
            </div>
            <div className="childActions">
              {home&&<span className={child.homeStatus==='inside'?'homeBadge inside':'homeBadge outside'}>
                {child.homeStatus==='inside'?'בבית':child.homeStatus==='outside'?'מחוץ לבית':'לא ידוע'}
              </span>}
              <button
                className={canBuzzNow()&&child.homeStatus==='inside'?'buzzButton':'buzzButton test'}
                onClick={e=>{
                  e.stopPropagation();
                  const testMode=!(canBuzzNow()&&child.homeStatus==='inside');
                  void sendBuzz(child,testMode);
                }}
              >
                🔔 {canBuzzNow()&&child.homeStatus==='inside'?'צפצף':'בדיקת צפצוף'}
              </button>
              <button className="locate" onClick={e=>{e.stopPropagation();requestLocation(child)}}><LocateFixed/> רענן</button>
            </div>
          </article>
        })}</div>}
      </section>
      {children.length>0&&<section className="mapPanel">
        <div className="mapHeader">
          <div>
            <h2>{selected?selected.name:'כל הילדים'}</h2>
            <p>{selected&&locations[selected.uid]?`${locationAge(locations[selected.uid].updatedAt)} · דיוק כ־${Math.round(locations[selected.uid].accuracy)} מטר`:`${Object.keys(locations).length} מתוך ${children.length} מיקומים זמינים`}</p>
          </div>
          <div className="mapActions">
            <button className="secondary compact" onClick={()=>{setSelected(null);setFitSignal(v=>v+1)}}><Maximize2/> הצג את כולם</button>
            {selected&&<button className="primary compact" onClick={()=>requestLocation(selected)}><LocateFixed/> רענן מיקום</button>}
          </div>
        </div>
        {Object.keys(locations).length>0?
          <MapContainer center={[locations[Object.keys(locations)[0]].lat,locations[Object.keys(locations)[0]].lng]} zoom={13} scrollWheelZoom className="map">
            <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
            <MapViewport childrenList={children} locations={locations} selected={selected} fitSignal={fitSignal}/>
            {home&&<>
              <Circle center={[home.lat,home.lng]} radius={30} pathOptions={{fillOpacity:0.08}}/>
              <Marker position={[home.lat,home.lng]} icon={createHomeMarkerIcon()} zIndexOffset={2000} interactive={false}/>
            </>}
            {children.map((child,index)=>{
              const loc=locations[child.uid];
              if(!loc) return null;

              const position=getDisplayPosition(child,index,children,locations);
              const markerIcon=createChildMarkerIcon(child,selected?.uid===child.uid);

              return <Marker
                key={child.uid}
                position={position}
                icon={markerIcon}
                eventHandlers={{click:()=>setSelected(child)}}
                zIndexOffset={selected?.uid===child.uid?1000:index}
              >
                <Popup>
                  <div className="mapPopup" dir="rtl">
                    <div className="mapPopupHeader">
                      <div className="avatar">{child.photoURL?<img src={child.photoURL}/>:child.name[0]}</div>
                      <div>
                        <b>{child.name}</b>
                        <small>{locationAge(loc.updatedAt)}</small>
                      </div>
                    </div>
                    <p>דיוק משוער: {Math.round(loc.accuracy)} מטר</p>
                    <button className="locate" onClick={()=>requestLocation(child)}>
                      <LocateFixed/> רענן מיקום
                    </button>
                  </div>
                </Popup>
              </Marker>
            })}
          </MapContainer>:
          <div className="mapPlaceholder"><MapPin/><span>ממתין למיקום הראשון של הילדים…</span></div>}
      </section>}
      <section className="share"><Users/><div className="grow"><h2>הורה שותף</h2><p>הורה נוסף בוחר “אני הורה” ומקליד את הקוד שלך.</p></div><CodeCard code={profile.code} compact/>
      </section>
    </main>

    {settingsOpen&&<div className="settingsOverlay" role="dialog" aria-modal="true">
      <section className="settingsModal">
        <header className="settingsHeader">
          <div>
            <span className="eyebrow">הגדרות</span>
            <h2>הגדרות FamilyPulse</h2>
          </div>
          <button className="iconButton" onClick={()=>setSettingsOpen(false)} aria-label="סגור"><X/></button>
        </header>

        <div className="settingsSection">
          <div className="settingsSectionTitle">
            <Home/>
            <div>
              <h3>בית</h3>
              <p>חפש כתובת, השתמש במיקום שלך או לחץ על המפה. הטווח קבוע על 30 מטר.</p>
            </div>
          </div>

          <div className="fixedRadius">רדיוס קבוע: <b>30 מטר</b></div>

          <div className="homeSearchRow">
            <input
              value={homeSearch}
              onChange={e=>setHomeSearch(e.target.value)}
              onKeyDown={e=>{if(e.key==='Enter') void searchHomeAddress();}}
              placeholder="רחוב, מספר, עיר"
            />
            <button className="primary compact" onClick={()=>void searchHomeAddress()} disabled={searchingHome||!homeSearch.trim()}>
              {searchingHome?'מחפש…':'חפש'}
            </button>
            <button className="secondary compact" onClick={useMyLocationForHome}><LocateFixed/> המיקום שלי</button>
          </div>

          {homeSearchError&&<div className="settingsError">{homeSearchError}</div>}

          {homeSearchResults.length>0&&<div className="addressResults">
            {homeSearchResults.map(result=><button
              key={result.place_id}
              className="addressResult"
              onClick={()=>{
                setHomeDraft({lat:Number(result.lat),lng:Number(result.lon),label:result.display_name});
                setHomeSearch(result.display_name);
                setHomeSearchResults([]);
              }}
            >
              <MapPin/>
              <span>{result.display_name}</span>
            </button>)}
          </div>}

          <MapContainer
            center={homeDraft?[homeDraft.lat,homeDraft.lng]:home?[home.lat,home.lng]:(Object.values(locations)[0]?[Object.values(locations)[0].lat,Object.values(locations)[0].lng]:[31.7683,35.2137])}
            zoom={homeDraft||home?18:12}
            scrollWheelZoom
            className="settingsMap"
          >
            <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
            <SettingsMapFocus home={homeDraft?{lat:homeDraft.lat,lng:homeDraft.lng,radiusMeters:30}:home}/>
            <HomeClickHandler enabled onPick={(lat,lng)=>setHomeDraft({lat,lng,label:'נקודה שנבחרה במפה'})}/>
            {(homeDraft||home)&&<>
              <Circle center={[homeDraft?.lat??home!.lat,homeDraft?.lng??home!.lng]} radius={30} pathOptions={{fillOpacity:0.1}}/>
              <Marker position={[homeDraft?.lat??home!.lat,homeDraft?.lng??home!.lng]} icon={createHomeMarkerIcon()} zIndexOffset={2000} interactive={false}/>
            </>}
          </MapContainer>

          <div className="homeDraftBar">
            <div>
              <b>{homeDraft?'המיקום שנבחר':'לא נבחר מיקום חדש'}</b>
              <span>{homeDraft?.label||'חפש כתובת, השתמש במיקום שלך או לחץ על המפה.'}</span>
            </div>
            <button className="primary" disabled={!homeDraft} onClick={()=>void saveHome()}>שמור את הבית</button>
          </div>
          <p className="settingsHint">{home?'הבית הנוכחי נשמר במערכת.':'עדיין לא נשמר בית.'}</p>
        </div>


      </section>
    </div>}
  </div>;
}

function Logo(){return <div className="logo"><span/><span/><span/></div>}
function Center({children}:{children:React.ReactNode}){return <div className="center">{children}</div>}
function CodeCard({code,title,compact=false}:{code:string;title?:string;compact?:boolean}){
  const copy=()=>navigator.clipboard.writeText(code);
  return <div className={compact?'codeCard compactCode':'codeCard'}>{title&&<span>{title}</span>}<strong>{code}</strong><button onClick={copy} aria-label="העתקת קוד"><Copy/></button></div>
}
function TopBar({profile,onLogout,onSettings}:{profile:Profile;onLogout:()=>void;onSettings?:()=>void}){return <header className="topbar"><div className="brand"><Logo/><b>FamilyPulse</b></div><div className="miniProfile"><span>{profile.role==='parent'?'הורה':'ילד/ה'}</span><div className="avatar tiny">{profile.photoURL?<img src={profile.photoURL}/>:profile.name[0]}</div>{onSettings&&<button className="settingsButton" onClick={onSettings}><Settings/> הגדרות</button>}<button className="logoutButton" onClick={onLogout}>התנתק</button></div></header>}


function locationAge(updatedAt?:{seconds:number}){
  if(!updatedAt?.seconds) return 'מיקום התקבל עכשיו';
  const diff=Math.max(0,Date.now()-updatedAt.seconds*1000);
  const seconds=Math.floor(diff/1000);
  if(seconds<10) return 'עודכן עכשיו';
  if(seconds<60) return `עודכן לפני ${seconds} שנ׳`;
  const minutes=Math.floor(seconds/60);
  if(minutes<60) return `עודכן לפני ${minutes} דק׳`;
  const hours=Math.floor(minutes/60);
  return `עודכן לפני ${hours} שע׳`;
}

function isPresenceOnline(p?:Presence){
  if(!p?.online || !p.lastSeen?.seconds) return false;
  return Date.now()-p.lastSeen.seconds*1000 < 90000;
}

function presenceText(p?:Presence){
  if(!p?.lastSeen?.seconds) return 'סטטוס חיבור לא ידוע';
  if(isPresenceOnline(p)) return 'מחובר עכשיו';
  return `לא מחובר · ${locationAge(p.lastSeen)}`;
}

function canBuzzNow(){
  const now=new Date();
  const day=now.getDay();
  const minutes=now.getHours()*60+now.getMinutes();
  return day>=0 && day<=4 && minutes>=8*60+10 && minutes<9*60;
}

function distanceMeters(lat1:number,lng1:number,lat2:number,lng2:number){
  const R=6371000;
  const toRad=(v:number)=>v*Math.PI/180;
  const dLat=toRad(lat2-lat1);
  const dLng=toRad(lng2-lng1);
  const a=Math.sin(dLat/2)**2+
    Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return 2*R*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

async function playAlarmTone(ctx:AudioContext,duration=60){
  if(ctx.state==='suspended') await ctx.resume();

  const start=ctx.currentTime;
  const end=start+duration;

  const compressor=ctx.createDynamicsCompressor();
  compressor.threshold.setValueAtTime(-8,start);
  compressor.knee.setValueAtTime(6,start);
  compressor.ratio.setValueAtTime(4,start);
  compressor.attack.setValueAtTime(0.001,start);
  compressor.release.setValueAtTime(0.08,start);
  compressor.connect(ctx.destination);

  const master=ctx.createGain();
  master.gain.setValueAtTime(0.0001,start);
  master.connect(compressor);

  // Loud repeating wake-up pattern: rapid triple beeps followed by a longer siren pulse.
  for(let t=0;t<duration;t+=1.6){
    const sequence=[
      [0.00,0.28],
      [0.38,0.66],
      [0.76,1.04],
      [1.14,1.52]
    ];
    for(const [on,off] of sequence){
      const onAt=Math.min(start+t+on,end);
      const offAt=Math.min(start+t+off,end);
      master.gain.setValueAtTime(0.0001,onAt);
      master.gain.exponentialRampToValueAtTime(1.0,Math.min(onAt+0.018,end));
      master.gain.setValueAtTime(1.0,Math.max(onAt,offAt-0.035));
      master.gain.exponentialRampToValueAtTime(0.0001,offAt);
    }
  }

  const oscA=ctx.createOscillator();
  const oscB=ctx.createOscillator();
  const oscC=ctx.createOscillator();
  const gainA=ctx.createGain();
  const gainB=ctx.createGain();
  const gainC=ctx.createGain();

  oscA.type='square';
  oscB.type='sawtooth';
  oscC.type='square';
  gainA.gain.setValueAtTime(0.42,start);
  gainB.gain.setValueAtTime(0.30,start);
  gainC.gain.setValueAtTime(0.24,start);

  oscA.connect(gainA); gainA.connect(master);
  oscB.connect(gainB); gainB.connect(master);
  oscC.connect(gainC); gainC.connect(master);

  for(let t=0;t<duration;t+=0.8){
    const a=start+t;
    const b=Math.min(a+0.4,end);
    const c=Math.min(a+0.8,end);

    oscA.frequency.setValueAtTime(920,a);
    oscA.frequency.linearRampToValueAtTime(1560,b);
    oscA.frequency.linearRampToValueAtTime(920,c);

    oscB.frequency.setValueAtTime(690,a);
    oscB.frequency.linearRampToValueAtTime(1180,b);
    oscB.frequency.linearRampToValueAtTime(690,c);

    oscC.frequency.setValueAtTime(1840,a);
    oscC.frequency.linearRampToValueAtTime(1260,b);
    oscC.frequency.linearRampToValueAtTime(1840,c);
  }

  oscA.start(start); oscB.start(start); oscC.start(start);
  oscA.stop(end); oscB.stop(end); oscC.stop(end);

  const vibrate=(navigator as Navigator & {vibrate?:(pattern:number|number[])=>boolean}).vibrate;
  vibrate?.call(navigator,[700,120,700,120,700,180,1400,180,1400,180,1400]);

  await new Promise(resolve=>setTimeout(resolve,duration*1000+250));
}

function SettingsMapFocus({home}:{home:HomeConfig|null}){
  const map=useMap();

  useEffect(()=>{
    if(home){
      map.setView([home.lat,home.lng],18,{animate:true});
    }
  },[map,home?.lat,home?.lng]);

  return null;
}

function HomeClickHandler({enabled,onPick}:{enabled:boolean;onPick:(lat:number,lng:number)=>void}){
  useMapEvents({
    click(e){
      if(enabled) onPick(e.latlng.lat,e.latlng.lng);
    }
  });
  return null;
}

function createHomeMarkerIcon(){
  return divIcon({
    className:'homeMarkerHost',
    html:'<div class="homeMarker"><span>⌂</span><b>בית</b></div>',
    iconSize:[66,34],
    iconAnchor:[33,17]
  });
}

function createChildMarkerIcon(child:Member,selected:boolean){
  const size=selected?38:32;

  if(child.photoURL){
    return icon({
      iconUrl:child.photoURL,
      iconSize:[size,size],
      iconAnchor:[size/2,size/2],
      popupAnchor:[0,-size/2],
      className:selected?'childImageMarker selected':'childImageMarker'
    });
  }

  return divIcon({
    className:'childPhotoMarkerHost',
    html:`<div class="childPhotoMarker${selected?' selected':''}"><span>${escapeHtml(child.name.trim().charAt(0)||'?')}</span></div>`,
    iconSize:[size,size],
    iconAnchor:[size/2,size/2],
    popupAnchor:[0,-size/2]
  });
}

function escapeHtml(value:string){
  return value
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#039;");
}

function getDisplayPosition(
  child:Member,
  index:number,
  childrenList:Member[],
  locations:Record<string,Location>
):[number,number]{
  const loc=locations[child.uid];
  if(!loc) return [0,0];

  let collisions=0;
  for(let i=0;i<index;i++){
    const other=locations[childrenList[i]?.uid];
    if(!other) continue;
    const veryClose=Math.abs(other.lat-loc.lat)<0.000025 && Math.abs(other.lng-loc.lng)<0.000025;
    if(veryClose) collisions++;
  }

  if(collisions===0) return [loc.lat,loc.lng];

  const angle=(collisions*137.5)*Math.PI/180;
  const offset=0.000035*Math.ceil(collisions/2);
  return [
    loc.lat+Math.cos(angle)*offset,
    loc.lng+Math.sin(angle)*offset
  ];
}

function MapViewport({childrenList,locations,selected,fitSignal}:{childrenList:Member[];locations:Record<string,Location>;selected:Member|null;fitSignal:number}){
  const map=useMap();

  useEffect(()=>{
    if(selected&&locations[selected.uid]){
      const loc=locations[selected.uid];
      map.setView([loc.lat,loc.lng],16,{animate:true});
      return;
    }

    const points=childrenList
      .map(child=>locations[child.uid])
      .filter((loc):loc is Location=>Boolean(loc))
      .map(loc=>[loc.lat,loc.lng] as [number,number]);

    if(points.length===1){
      map.setView(points[0],15,{animate:true});
    }else if(points.length>1){
      map.fitBounds(latLngBounds(points),{padding:[48,48],maxZoom:15,animate:true});
    }
  },[map,selected?.uid,fitSignal,childrenList.map(c=>c.uid).join('|'),Object.values(locations).map(l=>`${l.lat},${l.lng},${l.updatedAt?.seconds||0}`).join('|')]);

  return null;
}
