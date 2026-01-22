
import React, { useState } from 'react';
import { Trip, UserProfile, Language, CustomEvent } from '../types';
import { translations } from '../translations';
import { GeminiService } from '../services/geminiService';

interface PlannerProps {
  trips: Trip[];
  onAddTrip: (trip: Trip) => void;
  onUpdateTrip: (trip: Trip) => void;
  onDeleteTrip: (id: string) => void;
  onOpenTrip: (id: string) => void;
  language: Language;
  darkMode: boolean;
  userProfile: UserProfile;
  customEvents: CustomEvent[];
  onUpdateEvents: (events: CustomEvent[]) => void;
  onImportData: (data: any) => void;
  dataTimestamp: number;
  fullData: any;
}

const Planner: React.FC<PlannerProps> = ({ 
  trips, 
  onAddTrip, 
  onUpdateTrip, 
  onDeleteTrip, 
  onOpenTrip, 
  language, 
  darkMode, 
  userProfile,
  customEvents,
  onUpdateEvents,
  onImportData,
  dataTimestamp,
  fullData 
}) => {
  const t = translations[language];
  const [isCreating, setIsCreating] = useState(false);
  const [mode, setMode] = useState<'manual' | 'ai'>('manual');
  const [isGenerating, setIsGenerating] = useState(false);
  const [tripToDelete, setTripToDelete] = useState<string | null>(null);
  
  // Date Selection State
  const [startDate, setStartDate] = useState<Date | null>(new Date());
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [calendarView, setCalendarView] = useState(new Date());

  const [formState, setFormState] = useState<{
    destination: string;
    budget: number;
    currency: string;
    intent: string;
  }>({
    destination: '',
    budget: 0,
    currency: '$',
    intent: ''
  });

  // Calendar Logic
  const getDaysArray = (year: number, month: number) => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const days = [];
    for (let i = 0; i < firstDay.getDay(); i++) days.push(null);
    for (let i = 1; i <= lastDay.getDate(); i++) days.push(new Date(year, month, i));
    return days;
  };

  const calendarDays = getDaysArray(calendarView.getFullYear(), calendarView.getMonth());
  const monthName = calendarView.toLocaleString(language, { month: 'long', year: 'numeric' });

  const handleDateSelect = (date: Date) => {
    // Reset time to midnight for consistent comparison
    const newDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (!startDate || (startDate && endDate)) {
      setStartDate(newDate);
      setEndDate(null);
    } else {
      // If we have a start date but no end date
      if (newDate.getTime() < startDate.getTime()) {
        // If the new date is BEFORE the start date, swap them
        setEndDate(startDate);
        setStartDate(newDate);
      } else {
        // If the new date is AFTER the start date, set it as end date
        setEndDate(newDate);
      }
    }
  };

  const isSelected = (date: Date) => {
    if (!date) return false;
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const s = startDate ? new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()).getTime() : 0;
    const e = endDate ? new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()).getTime() : 0;
    return d === s || d === e;
  };

  const isInRange = (date: Date) => {
    if (!date || !startDate || !endDate) return false;
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const s = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()).getTime();
    const e = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()).getTime();
    return d > s && d < e;
  };

  const changeMonth = (delta: number) => {
    setCalendarView(new Date(calendarView.getFullYear(), calendarView.getMonth() + delta, 1));
  };

  const handleCreateTrip = async () => {
    if (!formState.destination || !startDate) return;

    // Calculate duration
    let duration = 1;
    if (endDate) {
      const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
      duration = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    }
    
    const startDateStr = startDate.toISOString().split('T')[0];
    const finalEndDate = endDate ? endDate.toISOString().split('T')[0] : startDateStr;

    if (mode === 'manual') {
      const newTrip: Trip = {
        id: Date.now().toString(),
        title: `Trip to ${formState.destination}`,
        location: formState.destination,
        startDate: startDateStr,
        endDate: finalEndDate,
        description: 'New adventure planned.',
        status: 'future',
        coverImage: `https://source.unsplash.com/800x600/?${formState.destination},travel`,
        photos: [],
        comments: [],
        rating: 0,
        dayRatings: {},
        favoriteDays: [],
        itinerary: {},
        budget: formState.budget,
        defaultCurrency: formState.currency
      };
      
      // Initialize empty itinerary
      let currentDate = new Date(startDate);
      for(let i=0; i < duration; i++) {
        newTrip.itinerary[currentDate.toISOString().split('T')[0]] = [];
        currentDate.setDate(currentDate.getDate() + 1);
      }

      onAddTrip(newTrip);
      setIsCreating(false);
      onOpenTrip(newTrip.id);
    } else {
      // AI Mode
      setIsGenerating(true);
      try {
        const result = await GeminiService.generateTripItinerary(
          formState.destination,
          duration,
          formState.budget,
          formState.currency,
          formState.intent || 'General sightseeing',
          language
        );

        if (result) {
          // Map the numeric keys from AI (1, 2, 3) to dates
          const mappedItinerary: Record<string, any[]> = {};
          if (result.itinerary) {
             Object.entries(result.itinerary).forEach(([dayNum, items]) => {
                const dayOffset = parseInt(dayNum) - 1;
                const date = new Date(new Date(startDate).getTime() + dayOffset * 24 * 60 * 60 * 1000);
                const dateStr = date.toISOString().split('T')[0];
                mappedItinerary[dateStr] = (items as any[]).map((item: any) => ({
                   ...item,
                   id: Math.random().toString(36).substr(2, 9),
                   actualExpense: 0
                }));
             });
          }

          const newTrip: Trip = {
             id: Date.now().toString(),
             title: result.title || `Trip to ${formState.destination}`,
             location: formState.destination,
             startDate: startDateStr,
             endDate: finalEndDate,
             description: result.description || 'AI Generated Trip',
             status: 'future',
             coverImage: `https://source.unsplash.com/800x600/?${formState.destination},landmark`,
             photos: [],
             comments: [],
             rating: 0,
             dayRatings: {},
             favoriteDays: [],
             itinerary: mappedItinerary,
             budget: formState.budget,
             defaultCurrency: formState.currency
          };
          
          onAddTrip(newTrip);
          setIsCreating(false);
          onOpenTrip(newTrip.id);
        } else {
          alert('Failed to generate trip. Please try again.');
        }
      } catch (e) {
        console.error(e);
        alert('An error occurred during generation.');
      } finally {
        setIsGenerating(false);
      }
    }
  };

  const handleRequestDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setTripToDelete(id);
  };

  const confirmDelete = () => {
    if (tripToDelete) {
      onDeleteTrip(tripToDelete);
      setTripToDelete(null);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in pb-24">
      <div className="flex justify-between items-end">
        <div>
           <h2 className="text-3xl font-black tracking-tight">{t.futureEscapes}</h2>
           <p className="text-sm font-bold text-gray-400">{t.dreamDesignDo}</p>
        </div>
        <button 
          onClick={() => setIsCreating(true)}
          className="bg-indigo-600 text-white px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl hover:bg-indigo-700 active:scale-95 transition-all"
        >
          + {t.planATrip}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {trips.map(trip => (
          <div key={trip.id} onClick={() => onOpenTrip(trip.id)} className={`group relative p-6 rounded-[2.5rem] border-2 cursor-pointer transition-all hover:scale-[1.02] active:scale-95 ${darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-100 shadow-sm hover:shadow-xl'}`}>
             <div className="aspect-video rounded-2xl overflow-hidden mb-4 bg-gray-200 relative">
               <img src={trip.coverImage} className="w-full h-full object-cover" />
               <button 
                 onClick={(e) => handleRequestDelete(e, trip.id)}
                 className="absolute top-2 right-2 p-2 bg-white/20 backdrop-blur-md rounded-xl text-white hover:bg-rose-500 transition-colors opacity-0 group-hover:opacity-100"
               >
                 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
               </button>
             </div>
             <h3 className="text-xl font-black mb-1">{trip.title}</h3>
             <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">{trip.startDate} • {Object.keys(trip.itinerary).length} Days</p>
             <div className="flex justify-between items-center">
                <span className="text-xs font-bold px-3 py-1 rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">{trip.location}</span>
                {trip.budget && <span className="text-xs font-mono opacity-50">{trip.defaultCurrency}{trip.budget}</span>}
             </div>
          </div>
        ))}
        {trips.length === 0 && (
          <div className="col-span-full py-20 text-center border-4 border-dashed border-gray-100 dark:border-zinc-800 rounded-[3rem]">
             <p className="text-gray-300 font-black text-xl">No future trips planned yet.</p>
          </div>
        )}
      </div>

      {isCreating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsCreating(false)} />
          <div className={`relative w-full max-w-lg p-8 rounded-[2.5rem] shadow-2xl animate-in zoom-in-95 max-h-[90vh] overflow-y-auto ${darkMode ? 'bg-zinc-900' : 'bg-white'}`}>
             <h3 className="text-3xl font-black mb-8">{t.newJourney}</h3>
             
             {/* Mode Switch */}
             <div className="flex p-1 rounded-2xl bg-zinc-100 dark:bg-zinc-800 mb-8">
                <button onClick={() => setMode('manual')} className={`flex-1 py-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all ${mode === 'manual' ? 'bg-white dark:bg-zinc-700 shadow-md text-black dark:text-white' : 'text-gray-400'}`}>
                  {t.manualMode}
                </button>
                <button onClick={() => setMode('ai')} className={`flex-1 py-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all ${mode === 'ai' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-400'}`}>
                  {t.aiMode}
                </button>
             </div>

             <div className="space-y-8">
                <div className="space-y-3">
                  <label className={`text-[10px] font-black uppercase tracking-widest px-1 ${darkMode ? 'text-white' : 'text-zinc-500'}`}>{t.destination}</label>
                  <input required value={formState.destination} onChange={e => setFormState({...formState, destination: e.target.value})} className={`w-full p-4 rounded-2xl border-2 text-xl font-black outline-none transition-colors ${darkMode ? 'bg-zinc-950 border-zinc-800 text-white focus:border-indigo-500' : 'bg-zinc-50 border-zinc-200 text-zinc-900 focus:border-indigo-500'}`} placeholder="Paris, France" />
                </div>
                
                {/* Custom Mini Calendar */}
                <div className="space-y-3">
                  <label className={`text-[10px] font-black uppercase tracking-widest px-1 ${darkMode ? 'text-white' : 'text-zinc-500'}`}>{t.chooseDates} {startDate && endDate && <span className="opacity-50 ml-2">({Math.ceil((Math.abs(endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1)} Days)</span>}</label>
                  <div className={`p-4 rounded-2xl border-2 ${darkMode ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-50 border-zinc-200'}`}>
                    <div className="flex justify-between items-center mb-4">
                      <button onClick={() => changeMonth(-1)} className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-full transition-colors"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7"/></svg></button>
                      <span className="font-bold text-sm">{monthName}</span>
                      <button onClick={() => changeMonth(1)} className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-full transition-colors"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7"/></svg></button>
                    </div>
                    <div className="grid grid-cols-7 gap-1 text-center mb-2">
                      {['S','M','T','W','T','F','S'].map(d => <span key={d} className="text-[10px] font-black opacity-30">{d}</span>)}
                    </div>
                    <div className="grid grid-cols-7 gap-1">
                      {calendarDays.map((day, idx) => {
                        if (!day) return <div key={idx} />;
                        const selected = isSelected(day);
                        const inRange = isInRange(day);
                        return (
                          <button
                            key={idx}
                            onClick={() => handleDateSelect(day)}
                            className={`
                              aspect-square rounded-full flex items-center justify-center text-xs font-bold transition-all
                              ${selected ? 'bg-indigo-600 text-white shadow-md scale-110 z-10' : ''}
                              ${inRange ? (darkMode ? 'bg-indigo-900/30 text-indigo-200' : 'bg-indigo-100 text-indigo-700') : ''}
                              ${!selected && !inRange ? (darkMode ? 'text-zinc-400 hover:bg-zinc-800' : 'text-zinc-600 hover:bg-zinc-200') : ''}
                            `}
                          >
                            {day.getDate()}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <label className={`text-[10px] font-black uppercase tracking-widest px-1 ${darkMode ? 'text-white' : 'text-zinc-500'}`}>{t.budget}</label>
                  <div className="flex gap-3">
                    <input 
                      required 
                      type="number" 
                      placeholder="0" 
                      value={formState.budget === 0 ? '' : formState.budget} 
                      onChange={e => setFormState({...formState, budget: parseFloat(e.target.value) || 0})} 
                      className={`flex-1 p-4 rounded-2xl border-2 text-xl font-black outline-none transition-colors ${darkMode ? 'bg-zinc-950 border-zinc-800 text-white focus:border-indigo-500' : 'bg-zinc-50 border-zinc-200 text-zinc-900 focus:border-indigo-500'}`} 
                    />
                    <select
                      value={formState.currency}
                      onChange={e => setFormState({...formState, currency: e.target.value})}
                      className={`w-24 p-4 rounded-2xl border-2 text-xl font-black outline-none transition-colors appearance-none text-center ${darkMode ? 'bg-zinc-950 border-zinc-800 text-white focus:border-indigo-500' : 'bg-zinc-50 border-zinc-200 text-zinc-900 focus:border-indigo-500'}`}
                    >
                      <option value="$">$</option>
                      <option value="€">€</option>
                      <option value="£">£</option>
                      <option value="¥">¥</option>
                      <option value="₩">₩</option>
                    </select>
                  </div>
                </div>
                
                {/* Description Field - Acts as Trip Intent for AI Mode */}
                {mode === 'ai' && (
                  <div className="space-y-3 animate-in fade-in">
                    <label className={`text-[10px] font-black uppercase tracking-widest px-1 text-indigo-500`}>{t.tripIntent}</label>
                    <textarea 
                      value={formState.intent} 
                      onChange={e => setFormState({...formState, intent: e.target.value})} 
                      className={`w-full p-4 rounded-2xl border-2 text-sm font-bold outline-none min-h-[120px] resize-none transition-colors ${darkMode ? 'bg-zinc-950 border-indigo-900/50 text-white focus:border-indigo-500' : 'bg-indigo-50/50 border-indigo-100 text-zinc-900 focus:border-indigo-500'}`} 
                      placeholder={t.tripIntentPlaceholder}
                    />
                  </div>
                )}
             </div>

             <div className="mt-10 flex gap-4">
               <button onClick={() => setIsCreating(false)} className={`flex-1 py-4 font-black uppercase tracking-widest text-xs rounded-2xl transition-colors ${darkMode ? 'bg-zinc-800 text-white hover:bg-zinc-700' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'}`}>
                 {t.cancel}
               </button>
               <button 
                 onClick={handleCreateTrip}
                 disabled={isGenerating || !formState.destination || !startDate}
                 className={`flex-[2] py-4 font-black uppercase tracking-widest text-xs rounded-2xl bg-indigo-600 text-white shadow-xl hover:bg-indigo-700 active:scale-95 transition-all flex items-center justify-center gap-2 ${isGenerating || !formState.destination || !startDate ? 'opacity-50 cursor-not-allowed' : ''}`}
               >
                 {isGenerating && <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>}
                 {mode === 'ai' ? t.generate : t.startJourney}
               </button>
             </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {tripToDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setTripToDelete(null)} />
          <div className={`relative w-full max-w-sm p-6 rounded-[2rem] shadow-2xl animate-in zoom-in-95 ${darkMode ? 'bg-zinc-900' : 'bg-white'}`}>
            <h3 className={`text-xl font-black mb-2 ${darkMode ? 'text-white' : 'text-zinc-900'}`}>Delete Trip?</h3>
            <p className="text-sm text-zinc-500 font-bold mb-6">This action cannot be undone. All data will be lost.</p>
            <div className="flex gap-3">
              <button 
                onClick={() => setTripToDelete(null)} 
                className={`flex-1 py-3 rounded-xl font-black uppercase text-xs tracking-widest ${darkMode ? 'bg-zinc-800 text-white hover:bg-zinc-700' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}
              >
                Cancel
              </button>
              <button 
                onClick={confirmDelete} 
                className="flex-1 py-3 rounded-xl font-black uppercase text-xs tracking-widest bg-rose-500 text-white hover:bg-rose-600 shadow-lg shadow-rose-500/30"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Planner;
