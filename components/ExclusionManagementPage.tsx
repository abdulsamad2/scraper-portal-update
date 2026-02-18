'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { 
  ArrowLeft, Save, Trash2, Plus, Filter 
} from 'lucide-react';
import { 
  getExclusionRules, 
  saveExclusionRules, 
  getEventSectionsAndRows, 
  SectionRowExclusion,
  ExclusionRulesData 
} from '@/actions/exclusionActions';
import { useNotifications } from '@/components/providers/NotificationProvider';
import { LoadingState, AsyncButton } from '@/components/ui/LoadingStates';

interface ExclusionPageProps {
  eventId: string;
  eventName: string;
}

interface SectionData {
  section: string;
  rows: string[];
  totalListings: number;
  avgPrice: number;
}



// Explicit state variants instead of boolean props
type PageState = 'loading' | 'ready' | 'saving' | 'error';

export default function ExclusionManagementPage({ eventId, eventName }: ExclusionPageProps) {
  const [pageState, setPageState] = useState<PageState>('loading');
  const [sections, setSections] = useState<SectionData[]>([]);
  
  // Exclusion rules state
  const [sectionRowExclusions, setSectionRowExclusions] = useState<SectionRowExclusion[]>([]);
  
  // Use lifted notification state
  const { actions: notificationActions } = useNotifications();

  const loadData = useCallback(async () => {
    setPageState('loading');
    try {
      const [rulesResult, sectionsResult] = await Promise.all([
        getExclusionRules(eventId),
        getEventSectionsAndRows(eventId)
      ]);

      if (sectionsResult.success && sectionsResult.data) {
        setSections(sectionsResult.data);
      }

      if (rulesResult.success && rulesResult.data) {
        const data = Array.isArray(rulesResult.data) ? rulesResult.data[0] : rulesResult.data;
        setSectionRowExclusions(data?.sectionRowExclusions || []);
      }
      
      setPageState('ready');
    } catch (error) {
      console.error('Error loading data:', error);
      notificationActions.showNotification('error', 'Failed to load exclusion data');
      setPageState('error');
    }
  }, [eventId, notificationActions]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSave = async () => {
    setPageState('saving');
    try {
      const rulesData: ExclusionRulesData = {
        eventId,
        eventName,
        sectionRowExclusions,
        isActive: true
      };

      const result = await saveExclusionRules(rulesData);
      
      if (result.success) {
        notificationActions.showNotification('success', 'Exclusion rules saved successfully');
        setPageState('ready');
      } else {
        notificationActions.showNotification('error', result.error || 'Failed to save exclusion rules');
        setPageState('ready');
      }
    } catch (error) {
      console.error('Error saving rules:', error);
      notificationActions.showNotification('error', 'Failed to save exclusion rules');
      setPageState('ready');
    }
  };

  const addSectionExclusion = () => {
    setSectionRowExclusions([
      ...sectionRowExclusions,
      { section: '', excludeEntireSection: false, excludedRows: [] }
    ]);
  };

  const removeSectionExclusion = (index: number) => {
    setSectionRowExclusions(sectionRowExclusions.filter((_, i) => i !== index));
  };

  const updateSectionExclusion = (index: number, updates: Partial<SectionRowExclusion>) => {
    setSectionRowExclusions(sectionRowExclusions.map((exclusion, i) => 
      i === index ? { ...exclusion, ...updates } : exclusion
    ));
  };

  const toggleRowExclusion = (sectionIndex: number, row: string) => {
    const exclusion = sectionRowExclusions[sectionIndex];
    const isExcluded = exclusion.excludedRows.includes(row);
    
    const newExcludedRows = isExcluded
      ? exclusion.excludedRows.filter(r => r !== row)
      : [...exclusion.excludedRows, row];
    
    updateSectionExclusion(sectionIndex, { excludedRows: newExcludedRows });
  };

  // Use explicit variants instead of boolean conditions
  if (pageState === 'loading') {
    return <LoadingState.Loading message="Loading exclusion settings..." />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Link 
            href={`/dashboard/events/${eventId}`}
            className="inline-flex items-center text-slate-600 hover:text-blue-600 transition-colors font-medium"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Event
          </Link>
          
          {/* Use compound component for async button */}
          {pageState === 'saving' ? (
            <LoadingState.Saving message="Saving Rules..." />
          ) : (
            <AsyncButton.Root onClick={handleSave} disabled={pageState !== 'ready'}>
              <AsyncButton.Icon>
                <Save size={16} />
              </AsyncButton.Icon>
              <AsyncButton.Text>
                Save Rules
              </AsyncButton.Text>
            </AsyncButton.Root>
          )}
        </div>

        {/* Title Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200/50 overflow-hidden backdrop-blur-sm">
          <div className="bg-gradient-to-r from-purple-600 to-indigo-600 p-8 text-white relative overflow-hidden">
            <div className="relative">
              <h1 className="text-4xl font-bold mb-3 text-white drop-shadow-sm">Exclusion Management</h1>
              <p className="text-purple-100 font-medium">Configure seat and price exclusions for: <strong>{eventName}</strong></p>
            </div>
          </div>
        </div>

        {/* Section & Row Exclusions */}
        <div className="space-y-6">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200/50 hover:shadow-2xl transition-all duration-300">
            <div className="p-8 border-b border-slate-200">
              <h2 className="text-2xl font-bold text-slate-800 mb-2 flex items-center gap-3">
                <Filter className="text-blue-600" size={24} />
                Section & Row Exclusions
              </h2>
              <p className="text-slate-600 font-medium">Exclude entire sections or specific rows from CSV generation</p>
            </div>
            
            <div className="p-8">
              <div className="space-y-6 mb-8">
                {sectionRowExclusions.map((exclusion, index) => (
                  <div key={index} className="border border-slate-200 rounded-2xl p-6 bg-gradient-to-r from-slate-50 to-slate-50 hover:from-slate-100 hover:to-slate-100 transition-all duration-200">
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="font-bold text-slate-800 text-lg">Exclusion Rule {index + 1}</h3>
                      <button
                        onClick={() => removeSectionExclusion(index)}
                        className="text-red-600 hover:text-red-800 transition-colors p-2 hover:bg-red-50 rounded-lg"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                    
                    <div className="space-y-6">
                      <div>
                        <label className="block text-sm font-bold text-slate-700 uppercase tracking-wider mb-3">Section</label>
                        <select
                          value={exclusion.section}
                          onChange={(e) => updateSectionExclusion(index, { 
                            section: e.target.value,
                            excludedRows: [] // Reset rows when section changes
                          })}
                          className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white shadow-sm font-medium"
                        >
                          <option value="">Select Section</option>
                          {sections.map(section => (
                            <option key={section.section} value={section.section}>
                              {section.section} ({section.totalListings} listings)
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex items-center space-x-3 bg-blue-50 p-4 rounded-xl border border-blue-200">
                        <input
                          type="checkbox"
                          checked={exclusion.excludeEntireSection}
                          onChange={(e) => updateSectionExclusion(index, { 
                            excludeEntireSection: e.target.checked,
                            excludedRows: e.target.checked ? [] : exclusion.excludedRows
                          })}
                          className="w-5 h-5 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                        />
                        <label className="text-sm font-bold text-slate-800">
                          Exclude entire section
                        </label>
                      </div>

                      {!exclusion.excludeEntireSection && exclusion.section && (
                        <div>
                          <label className="block text-sm font-bold text-slate-700 uppercase tracking-wider mb-3">
                            Excluded Rows ({exclusion.excludedRows.length} selected)
                          </label>
                          <div className="grid grid-cols-4 gap-3 max-h-40 overflow-y-auto bg-slate-50 p-4 rounded-xl border border-slate-200">
                            {sections.find(s => s.section === exclusion.section)?.rows.map(row => (
                              <button
                                key={row}
                                onClick={() => toggleRowExclusion(index, row)}
                                className={`px-4 py-2 text-sm rounded-lg border-2 transition-all font-semibold ${
                                  exclusion.excludedRows.includes(row)
                                    ? 'bg-red-100 border-red-300 text-red-700 hover:bg-red-200'
                                    : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100 hover:border-slate-400'
                                }`}
                              >
                                {row}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              
              <button
                onClick={addSectionExclusion}
                className="flex items-center justify-center space-x-3 w-full py-4 border-2 border-dashed border-slate-300 rounded-2xl text-slate-600 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-all duration-200 font-semibold"
              >
                <Plus size={24} />
                <span>Add Section Exclusion</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}