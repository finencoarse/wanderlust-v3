
import { createClient } from '@supabase/supabase-js';
import { Trip, TripVersion, ItineraryItem } from '../types';

// Use environment variables if available (e.g., from Vite define), otherwise fallback to defaults
const SUPABASE_URL = process.env.SUPABASE_URL || "https://ssqjipmiyrwswroebmsm.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNzcWppcG1peXJ3c3dyb2VibXNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg1NzY3OTAsImV4cCI6MjA4NDE1Mjc5MH0.75OkDqfSNsF34x5gj4x_KZ9M0OLkFha2Y3FGvpMQ20A";

const getSupabaseConfig = () => {
  // 1. Priority: Environment Variables (or hardcoded defaults)
  if (SUPABASE_URL && SUPABASE_KEY) {
    return { supabaseUrl: SUPABASE_URL, supabaseKey: SUPABASE_KEY };
  }

  // 2. Secondary: LocalStorage (set via Settings UI)
  const custom = localStorage.getItem('wanderlust_custom_supabase');
  if (custom) {
    try {
      return JSON.parse(custom);
    } catch (e) {
      console.error("Invalid custom config", e);
    }
  }
  return null;
};

// Initialize Supabase
let supabase: any = null;
const config = getSupabaseConfig();

if (config && config.supabaseUrl && config.supabaseKey) {
  try {
    supabase = createClient(config.supabaseUrl, config.supabaseKey);
  } catch (e) {
    console.warn("Supabase initialization failed:", e);
  }
}

export interface ConflictItem {
  tripId: string;
  tripTitle: string;
  field: string;
  localValue: string;
  remoteValue: string;
}

export class SupabaseService {
  
  static isCloudActive(): boolean {
    return !!supabase;
  }

  static isHardcoded(): boolean {
    return !!(SUPABASE_URL && SUPABASE_KEY);
  }

  // --- MERGE LOGIC ---

  private static mergeArrays<T extends { id: string }>(localArr: T[], remoteArr: T[]): T[] {
    const map = new Map<string, T>();
    // Add remote first
    remoteArr.forEach(item => map.set(item.id, item));
    // Add/Overwrite with local (Local wins for same-ID items by default, unless resolved otherwise at object level)
    localArr.forEach(item => map.set(item.id, item));
    return Array.from(map.values());
  }

  private static mergeItineraries(localItin: Record<string, ItineraryItem[]>, remoteItin: Record<string, ItineraryItem[]>) {
    const dates = new Set([...Object.keys(localItin || {}), ...Object.keys(remoteItin || {})]);
    const merged: Record<string, ItineraryItem[]> = {};
    dates.forEach(date => {
      merged[date] = this.mergeArrays(localItin[date] || [], remoteItin[date] || []);
    });
    return merged;
  }

  private static mergeTrips(localTrips: Trip[], remoteTrips: Trip[], resolutionMap: Record<string, 'local' | 'remote'> = {}): Trip[] {
    const map = new Map<string, Trip>();
    
    // Index remote trips
    remoteTrips.forEach(t => map.set(t.id, t));

    // Merge local trips
    localTrips.forEach(localTrip => {
      if (map.has(localTrip.id)) {
        const remoteTrip = map.get(localTrip.id)!;
        
        // Determine which metadata wins based on user selection
        // Default is 'local' wins if not specified
        const preferred = resolutionMap[localTrip.id] || 'local';
        
        const base = preferred === 'local' ? remoteTrip : localTrip;
        const overlay = preferred === 'local' ? localTrip : remoteTrip;

        // Deep merge components
        const mergedTrip: Trip = {
          ...base,
          ...overlay, // Overlay scalar fields (title, location, dates) based on preference
          
          // Lists are always Union Merged regardless of scalar preference
          itinerary: this.mergeItineraries(localTrip.itinerary, remoteTrip.itinerary),
          photos: this.mergeArrays(localTrip.photos, remoteTrip.photos),
          comments: this.mergeArrays(localTrip.comments, remoteTrip.comments),
          expenses: this.mergeArrays(localTrip.expenses || [], remoteTrip.expenses || []),
          resources: this.mergeArrays(localTrip.resources || [], remoteTrip.resources || []),
          flights: { ...remoteTrip.flights, ...localTrip.flights },
          hotels: this.mergeArrays(localTrip.hotels || [], remoteTrip.hotels || [])
        };
        map.set(localTrip.id, mergedTrip);
      } else {
        map.set(localTrip.id, localTrip);
      }
    });

    return Array.from(map.values());
  }

  private static smartMerge(localData: any, remoteData: any, resolutionMap: Record<string, 'local' | 'remote'> = {}): any {
    return {
      userProfile: { ...remoteData.userProfile, ...localData.userProfile }, // Local profile usually wins
      customEvents: this.mergeArrays(localData.customEvents || [], remoteData.customEvents || []),
      trips: this.mergeTrips(localData.trips || [], remoteData.trips || [], resolutionMap)
    };
  }

  // --- CONFLICT DETECTION ---

  /**
   * Fetches remote data and checks for conflicts in Trip Metadata.
   * Returns { conflicts, remoteData }. 
   * If conflicts exist, UI should prompt user. If not, UI can proceed to save.
   */
  static async checkForConflicts(syncId: string, localData: any): Promise<{ conflicts: ConflictItem[], remoteData: any | null }> {
    const result = await this.loadGlobalBackup(syncId);
    
    if (!result) {
      return { conflicts: [], remoteData: null };
    }

    const { data: remoteData, timestamp: remoteTimestamp } = result;

    // --- 15-MINUTE RULE ---
    // If the cloud data hasn't been updated in the last 15 minutes,
    // we assume the current user's session is the authority and skip the manual conflict resolution.
    // We still return remoteData so performSync can merge non-conflicting list items.
    if (remoteTimestamp) {
        const remoteTime = new Date(remoteTimestamp).getTime();
        const currentTime = Date.now();
        const diffMinutes = (currentTime - remoteTime) / (1000 * 60);

        if (diffMinutes > 15) {
            console.log(`Remote data is ${diffMinutes.toFixed(1)} mins old. Skipping conflict prompt.`);
            return { conflicts: [], remoteData };
        }
    }

    const conflicts: ConflictItem[] = [];
    const localTrips = localData.trips as Trip[];
    const remoteTrips = (remoteData.trips || []) as Trip[];

    for (const lTrip of localTrips) {
      const rTrip = remoteTrips.find(t => t.id === lTrip.id);
      if (rTrip) {
        // Compare Scalar Fields
        if (lTrip.title !== rTrip.title) {
          conflicts.push({ tripId: lTrip.id, tripTitle: lTrip.title, field: 'Title', localValue: lTrip.title, remoteValue: rTrip.title });
        }
        if (lTrip.location !== rTrip.location) {
          conflicts.push({ tripId: lTrip.id, tripTitle: lTrip.title, field: 'Location', localValue: lTrip.location, remoteValue: rTrip.location });
        }
        if (lTrip.startDate !== rTrip.startDate || lTrip.endDate !== rTrip.endDate) {
          conflicts.push({ 
            tripId: lTrip.id, 
            tripTitle: lTrip.title, 
            field: 'Dates', 
            localValue: `${lTrip.startDate} - ${lTrip.endDate}`, 
            remoteValue: `${rTrip.startDate} - ${rTrip.endDate}` 
          });
        }
        if (lTrip.description !== rTrip.description) {
           // Only flag significant description changes (simple check)
           if (Math.abs(lTrip.description.length - rTrip.description.length) > 5) {
             conflicts.push({ tripId: lTrip.id, tripTitle: lTrip.title, field: 'Description', localValue: 'Local Edits', remoteValue: 'Remote Edits' });
           }
        }
      }
    }

    return { conflicts, remoteData };
  }

  // --- VERSIONING ---

  static async saveTripVersion(trip: Trip, note: string): Promise<string | null> {
    const userId = localStorage.getItem('wanderlust_sync_id') || 'guest';
    
    const data = {
      trip_id: trip.id,
      timestamp: new Date().toISOString(),
      note: note,
      data: trip,
      user_id: userId
    };

    if (this.isCloudActive()) {
      const { data: result, error } = await supabase
        .from('trip_versions')
        .insert(data)
        .select()
        .single();
      
      if (error) throw error;
      return result.id;
    } else {
      const key = `wanderlust_local_versions_${trip.id}`;
      const existing = JSON.parse(localStorage.getItem(key) || '[]');
      const newVersion = { id: `local-${Date.now()}`, ...data, tripId: trip.id };
      localStorage.setItem(key, JSON.stringify([newVersion, ...existing]));
      return newVersion.id;
    }
  }

  static async getTripVersions(tripId: string): Promise<TripVersion[]> {
    if (this.isCloudActive()) {
      const { data, error } = await supabase
        .from('trip_versions')
        .select('*')
        .eq('trip_id', tripId)
        .order('timestamp', { ascending: false });

      if (error) {
        console.error("Supabase Error:", error);
        return [];
      }

      return data.map((row: any) => ({
        id: row.id,
        tripId: row.trip_id,
        timestamp: row.timestamp,
        note: row.note,
        data: row.data
      })) as TripVersion[];
    } else {
      const key = `wanderlust_local_versions_${tripId}`;
      const versions = JSON.parse(localStorage.getItem(key) || '[]');
      return versions as TripVersion[];
    }
  }

  static async findVersions(query: string): Promise<TripVersion[]> {
    if (!this.isCloudActive()) return [];

    let { data, error } = await supabase
      .from('trip_versions')
      .select('*')
      .eq('trip_id', query)
      .order('timestamp', { ascending: false });

    if (!data || data.length === 0) {
       const res = await supabase
        .from('trip_versions')
        .select('*')
        .eq('user_id', query)
        .order('timestamp', { ascending: false });
       data = res.data;
       error = res.error;
    }

    if (error) {
      console.error("Search Error:", error);
      throw error;
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      tripId: row.trip_id,
      timestamp: row.timestamp,
      note: row.note,
      data: row.data
    })) as TripVersion[];
  }

  // --- GLOBAL SYNC ---

  /**
   * Perform the Merge & Save operation.
   * @param syncId The ID
   * @param localData Current app state
   * @param remoteData Pre-fetched remote data (optional optimization)
   * @param resolutionMap Map of tripId -> 'local' | 'remote' for conflict resolution
   */
  static async saveGlobalBackup(
    syncId: string, 
    localData: any, 
    remoteData?: any, 
    resolutionMap: Record<string, 'local' | 'remote'> = {}
  ): Promise<any> {
    const timestamp = new Date().toISOString();
    let finalData = localData;

    // Cloud Mode
    if (this.isCloudActive()) {
      // 1. If remoteData wasn't passed from conflict check, fetch it now
      let rData = remoteData;
      if (!rData) {
        const result = await this.loadGlobalBackup(syncId);
        rData = result?.data;
      }

      // 2. Smart Merge
      if (rData) {
        finalData = this.smartMerge(localData, rData, resolutionMap);
      }

      const backupData = {
        sync_id: syncId,
        timestamp: timestamp,
        data: finalData,
        user_id: 'guest'
      };

      // 3. Upsert Merged Data
      const { error } = await supabase
        .from('global_backups')
        .upsert(backupData, { onConflict: 'sync_id' });
      
      if (error) throw error;
    } 
    // Local Mode
    else {
      const existing = localStorage.getItem(`wanderlust_backup_${syncId}`);
      if (existing) {
         const parsed = JSON.parse(existing);
         finalData = this.smartMerge(localData, parsed.data, resolutionMap);
      }
      const backupData = {
        sync_id: syncId,
        timestamp: timestamp,
        data: finalData,
        user_id: 'guest'
      };
      localStorage.setItem(`wanderlust_backup_${syncId}`, JSON.stringify(backupData));
    }

    return finalData;
  }

  static async loadGlobalBackup(syncId: string): Promise<{ data: any, timestamp: string } | null> {
    if (this.isCloudActive()) {
      const { data, error } = await supabase
        .from('global_backups')
        .select('data, timestamp')
        .eq('sync_id', syncId)
        .single();

      if (error || !data) return null;
      return { data: data.data, timestamp: data.timestamp };
    } else {
      const stored = localStorage.getItem(`wanderlust_backup_${syncId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        return { data: parsed.data, timestamp: parsed.timestamp };
      }
      return null;
    }
  }
}
