import { useEffect, useMemo, useState } from 'react';
import {
  collection, doc, getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc
} from 'firebase/firestore';
import { CircleMarker, MapContainer, TileLayer } from 'react-leaflet';
import { Baby, Copy, LocateFixed, MapPin, Plus, ShieldCheck, Smartphone, Users } from 'lucide-react';
import { auth, db, ensureAuth, firebaseReady } from './firebase';

type Role='parent'|'child';
type Profile={uid:string;name:string;photoURL?:string;role:Role;code:string;familyId?:string};
type Member={uid:string;name:string;photoURL?:string;role:Role;inviteCode?:string};
type Location={lat:number;lng:number;accuracy:number;familyId:string;updatedAt?:{seconds:number}};

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
  const [location,setLocation]=useState<Location|null>(null);
  const [message,setMessage]=useState('');

  useEffect(()=>{(async()=>{
    if(!firebaseReady){setLoading(false);return;}
    const user=await ensureAuth();
    const snap=await getDoc(doc(db,'users',user.uid));
    if(snap.exists()) setProfile({uid:user.uid,...snap.data()} as Profile);
    setLoading(false);
  })().catch(e=>{console.error(e);setLoading(false);});},[]);

  useEffect(()=>{
    if(!profile?.familyId) return;
    return onSnapshot(collection(db,'families',profile.familyId,'members'),snap=>{
      const next=snap.docs.map(d=>d.data() as Member);
      setMembers(next);
      if(!selected) setSelected(next.find(x=>x.role==='child')||null);
    });
  },[profile?.familyId]);

  useEffect(()=>{
    if(!profile || profile.role!=='child') return;
    const reqRef=doc(db,'locationRequests',profile.uid);
    return onSnapshot(reqRef,async snap=>{
      const data=snap.data();
      if(!data || data.status!=='requested' || !data.familyId) return;
      try{
        const pos=await new Promise<GeolocationPosition>((resolve,reject)=>
          navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:20000,maximumAge:0})
        );
        await setDoc(doc(db,'locations',profile.uid),{
          lat:pos.coords.latitude,lng:pos.coords.longitude,accuracy:pos.coords.accuracy,
          familyId:data.familyId,updatedAt:serverTimestamp()
        });
        await updateDoc(reqRef,{status:'completed',completedAt:serverTimestamp()});
        setMessage('המיקום נשלח להורה בהצלחה.');
      }catch{
        await updateDoc(reqRef,{status:'failed',completedAt:serverTimestamp()});
        setMessage('לא ניתן לקבל מיקום. יש לאשר הרשאת מיקום בדפדפן.');
      }
    });
  },[profile]);

  useEffect(()=>{
    if(!selected) {setLocation(null);return;}
    return onSnapshot(doc(db,'locations',selected.uid),snap=>setLocation(snap.exists()?snap.data() as Location:null));
  },[selected?.uid]);

  async function createProfile(){
    if(!setupRole || !name.trim()) return;
    setLoading(true);
    try{
      const user=await ensureAuth();
      let photoURL='';
      if(photo){
        const storageRef=ref(storage,`profiles/${user.uid}/avatar-${Date.now()}`);
        await uploadBytes(storageRef,photo);
        photoURL=await getDownloadURL(storageRef);
      }
      const code=randomCode();
      let familyId:string|undefined;
      if(setupRole==='parent'){
        familyId=randomId();
        await setDoc(doc(db,'families',familyId),{createdAt:serverTimestamp(),ownerUid:user.uid});
        await setDoc(doc(db,'families',familyId,'members',user.uid),{uid:user.uid,name:name.trim(),photoURL,role:'parent'});
      }
      const p:Profile={uid:user.uid,name:name.trim(),photoURL,role:setupRole,code,familyId};
      await setDoc(doc(db,'users',user.uid),p);
      await setDoc(doc(db,'pairCodes',code),{
        uid:user.uid,type:setupRole,familyId:familyId||null,name:p.name,photoURL:photoURL||'',createdAt:serverTimestamp()
      });
      setProfile(p);
    }finally{setLoading(false);}
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
        uid:data.uid,name:data.name,photoURL:data.photoURL||'',role:'child',inviteCode:code
      });
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

  async function requestLocation(child:Member){
    setSelected(child);setMessage('מבקש מיקום עדכני…');
    await setDoc(doc(db,'locationRequests',child.uid),{
      childUid:child.uid,requestedBy:profile?.uid,familyId:profile?.familyId,status:'requested',requestedAt:serverTimestamp()
    });
  }

  const children=useMemo(()=>members.filter(m=>m.role==='child'),[members]);
  const parents=useMemo(()=>members.filter(m=>m.role==='parent'),[members]);

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
    </div>}
  </div>;

  if(profile.role==='child') return <div className="childPage">
    <TopBar profile={profile}/>
    <main className="childMain">
      <div className="pulseOrb"><MapPin/></div>
      <h1>הכול מחובר</h1>
      <p>אין צורך להשאיר GPS פעיל כל הזמן. כשהורה מבקש מיקום בזמן שהאפליקציה פתוחה, FamilyPulse מקבל נקודה עדכנית ושולח אותה.</p>
      <CodeCard code={profile.code} title="קוד החיבור שלך"/>
      <div className="infoBox"><Smartphone/><span>באייפון, אם ה־PWA סגור לגמרי, האתר לא יכול להדליק GPS ברקע. פתח/י את FamilyPulse כאשר ההורה מבקש מיקום.</span></div>
      {message&&<div className="toast">{message}</div>}
    </main>
  </div>;

  return <div className="appShell">
    <TopBar profile={profile}/>
    <main className="dashboard">
      <section className="hero"><div><span className="eyebrow">המשפחה שלי</span><h1>שלום, {profile.name}</h1><p>{children.length} ילדים · {parents.length} הורים מחוברים</p></div><div className="avatar big">{profile.photoURL?<img src={profile.photoURL}/>:profile.name[0]}</div></section>
      <section className="connectPanel">
        <div><h2><Plus/> הוספת ילד או הורה</h2><p>הקלד קוד. FamilyPulse מזהה אוטומטית אם זה ילד או הורה שותף.</p></div>
        <div className="codeInput"><input value={joinCode} onChange={e=>setJoinCode(e.target.value.toUpperCase())} maxLength={8} placeholder="AB12CD34"/><button onClick={connectCode}>חבר</button></div>
        {message&&<div className="toast">{message}</div>}
      </section>
      <section><div className="sectionTitle"><h2>הילדים</h2><span>{children.length}</span></div>
        {children.length===0?<div className="empty"><Baby/><h3>עוד אין ילדים מחוברים</h3><p>פתח FamilyPulse במכשיר הילד והקלד כאן את הקוד שלו.</p></div>:
        <div className="childrenGrid">{children.map(child=><article className={selected?.uid===child.uid?'childCard active':'childCard'} key={child.uid} onClick={()=>setSelected(child)}>
          <div className="avatar">{child.photoURL?<img src={child.photoURL}/>:child.name[0]}</div><div className="grow"><b>{child.name}</b><span>{selected?.uid===child.uid&&location?'מיקום התקבל':'מוכן לבדיקה'}</span></div>
          <button className="locate" onClick={e=>{e.stopPropagation();requestLocation(child)}}><LocateFixed/> מצא עכשיו</button>
        </article>)}</div>}
      </section>
      {selected&&<section className="mapPanel">
        <div className="mapHeader"><div><h2>{selected.name}</h2><p>{location?`דיוק משוער: ${Math.round(location.accuracy)} מטר`:'עדיין אין מיקום עדכני'}</p></div><button className="primary compact" onClick={()=>requestLocation(selected)}><LocateFixed/> רענן מיקום</button></div>
        {location?<MapContainer center={[location.lat,location.lng]} zoom={17} scrollWheelZoom className="map"><TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><CircleMarker center={[location.lat,location.lng]} radius={10} pathOptions={{fillOpacity:0.9}}/></MapContainer>:<div className="mapPlaceholder"><MapPin/><span>לחץ “מצא עכשיו” לקבלת מיקום</span></div>}
      </section>}
      <section className="share"><Users/><div className="grow"><h2>הורה שותף</h2><p>הורה נוסף בוחר “אני הורה” ומקליד את הקוד שלך.</p></div><CodeCard code={profile.code} compact/>
      </section>
    </main>
  </div>;
}

function Logo(){return <div className="logo"><span/><span/><span/></div>}
function Center({children}:{children:React.ReactNode}){return <div className="center">{children}</div>}
function CodeCard({code,title,compact=false}:{code:string;title?:string;compact?:boolean}){
  const copy=()=>navigator.clipboard.writeText(code);
  return <div className={compact?'codeCard compactCode':'codeCard'}>{title&&<span>{title}</span>}<strong>{code}</strong><button onClick={copy} aria-label="העתקת קוד"><Copy/></button></div>
}
function TopBar({profile}:{profile:Profile}){return <header className="topbar"><div className="brand"><Logo/><b>FamilyPulse</b></div><div className="miniProfile"><span>{profile.role==='parent'?'הורה':'ילד/ה'}</span><div className="avatar tiny">{profile.photoURL?<img src={profile.photoURL}/>:profile.name[0]}</div></div></header>}
