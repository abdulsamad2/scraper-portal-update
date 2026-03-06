"use client";
import React, { useEffect, useState } from "react";
import { createEvent, updateEvent } from "@/actions/eventActions";
import { EventFormProvider, useEventForm } from "@/components/providers/EventFormProvider";
import { EventFormFields } from "@/components/ui/FormFields";
import { EventFormMode, FormStatusMessages } from "@/components/ui/FormModes";
import { useNotifications } from "@/components/providers/NotificationProvider";
import { Loader2, Wand2 } from "lucide-react";

// Explicit mode variants instead of boolean isEdit prop
const CreateEventForm = ({ onCancel, onSuccess }) => {
  return (
    <EventFormProvider>
      <EventFormContent 
        mode="create" 
        onCancel={onCancel} 
        onSuccess={onSuccess} 
      />
    </EventFormProvider>
  );
};

const EditEventForm = ({ onCancel, onSuccess, initialData }) => {
  return (
    <EventFormProvider initialData={initialData}>
      <EventFormContent 
        mode="edit" 
        onCancel={onCancel} 
        onSuccess={onSuccess}
        initialData={initialData}
      />
    </EventFormProvider>
  );
};

// Main form content using composition patterns
const EventFormContent = ({ mode, onCancel, onSuccess, initialData }) => {
  const form = useEventForm();
  const notifications = useNotifications();
  const [fetchingVividId, setFetchingVividId] = useState(false);

  // Helper function to extract Event ID from URL
  const extractEventIdFromUrl = (url) => {
    try {
      const parsed = new URL(url);
      if (
        /ticketmaster\.(com|ca|co\.uk)$/i.test(parsed.hostname) &&
        parsed.pathname.includes("/event/")
      ) {
        const pathParts = parsed.pathname.split("/");
        const eventIdIndex =
          pathParts.findIndex((part) => part === "event") + 1;
        if (eventIdIndex < pathParts.length) {
          return pathParts[eventIdIndex];
        }
      }
      return "";
    } catch {
      return "";
    }
  };

  // Helper function to extract event data from Ticketmaster URL
  const extractEventDataFromUrl = (url) => {
    try {
      const parsed = new URL(url);
      if (
        /ticketmaster\.(com|ca|co\.uk)$/i.test(parsed.hostname) &&
        parsed.pathname.includes("/event/")
      ) {
        // Extract event ID
        const pathParts = parsed.pathname.split("/");
        const eventIdIndex = pathParts.findIndex((part) => part === "event") + 1;
        const eventId = eventIdIndex < pathParts.length ? pathParts[eventIdIndex] : "";
        
        // Extract event name and details from URL path
        const eventPathPart = pathParts[pathParts.indexOf("event") - 1] || "";
        
        let eventName = "";
        let venue = "";
        let eventDate = "";
        
        if (eventPathPart) {
          // Split by hyphens and try to extract information
          const parts = eventPathPart.split("-");
          
          // Look for date pattern - try multiple formats
          let dateIndex = -1;
          
          // Try to find date pattern at the end of URL
          for (let i = parts.length - 1; i >= 2; i--) {
            const part1 = parts[i-2];
            const part2 = parts[i-1]; 
            const part3 = parts[i];
            
            // Check if we have 3 numeric parts that could be a date
            if (/^\d{2,4}$/.test(part1) && /^\d{2}$/.test(part2) && /^\d{2,4}$/.test(part3)) {
              let year, month, day;
              
              // Determine which part is the year (4 digits or > 31)
              if (part1.length === 4 || parseInt(part1) > 31) {
                year = part1;
                month = part2.padStart(2, '0');
                day = part3.padStart(2, '0');
              } else if (part3.length === 4 || parseInt(part3) > 31) {
                year = part3;
                month = part1.padStart(2, '0');
                day = part2.padStart(2, '0');
              } else {
                continue;
              }
              
              // Validate month and day ranges
              const monthNum = parseInt(month);
              const dayNum = parseInt(day);
              if (monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31) {
                eventDate = `${year}-${month}-${day}T19:00`; // Default to 7 PM
                dateIndex = i - 2;
                break;
              }
            }
          }
          
          if (dateIndex >= 0) {
            // Extract event name (everything before location/date info)
            const nameParts = parts.slice(0, Math.max(1, dateIndex - 1));
            eventName = nameParts.map(part => 
              part.charAt(0).toUpperCase() + part.slice(1).replace(/[^a-zA-Z0-9\s]/g, '')
            ).join(" ").trim();
            
            // Extract venue (parts between name and date)
            if (dateIndex > 1) {
              const venueParts = parts.slice(Math.max(1, dateIndex - 1), dateIndex);
              venue = venueParts.map(part => 
                part.charAt(0).toUpperCase() + part.slice(1).replace(/[^a-zA-Z0-9\s]/g, '')
              ).join(" ").trim();
            }
          } else {
            // Fallback: use first few parts as event name
            eventName = parts.slice(0, Math.min(4, parts.length))
              .map(part => part.charAt(0).toUpperCase() + part.slice(1).replace(/[^a-zA-Z0-9\s]/g, ''))
              .join(" ").trim();
          }
        }
        
        // Calculate in-hand date:
        // If event is today or in the past (in venue's local timezone), in-hand date = event date
        // If event is in the future, in-hand date = event date - 1 day
        let inHandDate = "";
        if (eventDate) {
          const eventDateTime = new Date(eventDate);
          if (!isNaN(eventDateTime.getTime())) {
            const eventDateOnly = eventDateTime.toISOString().slice(0, 10);
            // Get today's date — use UTC as a reasonable default for the form
            const todayStr = new Date().toISOString().slice(0, 10);
            const inHandDateTime = new Date(eventDateTime);
            if (eventDateOnly > todayStr) {
              inHandDateTime.setDate(inHandDateTime.getDate() - 1);
            }
            inHandDate = inHandDateTime.toISOString().slice(0, 10);
          }
        }
        
        return {
          eventId,
          eventName,
          venue,
          eventDate,
          inHandDate
        };
      }
      return null;
    } catch (error) {
      console.error('Error parsing URL:', error);
      return null;
    }
  };

  // Form field change handlers using new composition patterns
  const handleInputChange = (e) => {
    const { name, value } = e.target;

    // Special handling for URL changes - try to extract all event data
    if (name === "URL" && form.actions.validateField) {
      const extractedData = extractEventDataFromUrl(value);
      if (extractedData) {
        // Update multiple fields at once
        form.actions.updateField('URL', value);
        if (extractedData.eventId) form.actions.updateField('Event_ID', extractedData.eventId);
        if (extractedData.eventName) form.actions.updateField('Event_Name', extractedData.eventName);
        if (extractedData.venue) form.actions.updateField('Venue', extractedData.venue);
        if (extractedData.eventDate) form.actions.updateField('Event_DateTime', extractedData.eventDate);
        if (extractedData.inHandDate) form.actions.updateField('inHandDate', extractedData.inHandDate);
      } else {
        // Always extract and update event ID from URL
        const extractedId = extractEventIdFromUrl(value);
        form.actions.updateField('URL', value);
        if (extractedId) {
          form.actions.updateField('Event_ID', extractedId);
        }
      }
    } else {
      form.actions.updateField(name, value);
    }
  };

  const handleBlur = (e) => {
    const { name } = e.target;
    form.actions.validateField(name);
  };

  const handleCheckboxChange = (e) => {
    const { name, checked } = e.target;
    form.actions.updateField(name, checked);
  };

  /* ---- Vivid Seats mapping ID fetch ---- */
  const handleFetchVividId = async () => {
    const eventName = form.data.Event_Name.value;
    const eventDate = form.data.Event_DateTime.value;
    const venueName = form.data.Venue.value;

    if (!eventName) {
      form.actions.setError('Enter an Event Name before fetching Vivid ID');
      return;
    }

    setFetchingVividId(true);
    form.actions.setError('');

    try {
      // Extract search terms from event name
      const extractSearchTerms = (name) => {
        const terms = [];
        const atMatch = name.match(/(.+?)\s+at\s+(.+)/i);
        if (atMatch) { terms.push(atMatch[2].trim()); terms.push(atMatch[1].trim()); }
        const vsMatch = name.match(/(.+?)\s+vs\.?\s+(.+)/i);
        if (vsMatch) { terms.push(vsMatch[1].trim()); terms.push(vsMatch[2].trim()); }
        if (terms.length === 0) {
          const parts = name.split(/[|–—]/);
          const primary = parts[0]?.trim().replace(/\(.*?\)/g, '').replace(/\s*tickets?\s*$/i, '').trim();
          if (primary) terms.push(primary);
          const full = name.replace(/\(.*?\)/g, '').replace(/\s*tickets?\s*$/i, '').trim();
          if (full && !terms.includes(full)) terms.push(full);
        }
        return [...new Set(terms)].filter(Boolean);
      };

      const searchTerms = extractSearchTerms(eventName);
      if (searchTerms.length === 0) {
        form.actions.setError('Could not extract search term from event name');
        return;
      }

      // Step 1: Find performer/production via server (search redirect)
      let performerId = null;
      let directProductionId = null;
      for (const term of searchTerms) {
        const res = await fetch(`/api/vividseats/lookup?searchTerm=${encodeURIComponent(term)}`);
        const data = await res.json();
        if (data.directProductionId) { directProductionId = data.directProductionId; break; }
        if (data.performerId) { performerId = data.performerId; break; }
      }

      // Step 2: Direct production — fetch details and set
      if (directProductionId) {
        const res = await fetch(`/api/vividseats/proxy?path=productions/${directProductionId}`);
        if (res.ok) {
          const prod = await res.json();
          if (prod?.id) {
            form.actions.updateField('mapping_id', String(prod.id));
            return;
          }
        }
      }

      if (!performerId) {
        form.actions.setError(`No Vivid Seats performer found for "${searchTerms[0]}"`);
        return;
      }

      // Step 3: Fetch all productions for performer via proxy
      const prodRes = await fetch(`/api/vividseats/proxy?path=productions&performerId=${performerId}`);
      if (!prodRes.ok) {
        form.actions.setError('Failed to fetch productions from Vivid Seats');
        return;
      }
      const prodData = await prodRes.json();
      const productions = prodData.items || prodData || [];

      if (productions.length === 0) {
        form.actions.setError('Performer found but no upcoming events on Vivid Seats');
        return;
      }

      // Step 4: Match by date + venue (client-side)
      const targetDate = (eventDate || '').slice(0, 10);
      const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

      let match = null;
      if (targetDate) {
        const dateMatches = productions.filter((p) => {
          if (p.localDate?.slice(0, 10) === targetDate) return true;
          if (p.utcDate) {
            try { if (new Date(p.utcDate).toISOString().slice(0, 10) === targetDate) return true; } catch { /* skip */ }
          }
          return false;
        });

        if (dateMatches.length === 1) {
          match = dateMatches[0];
        } else if (dateMatches.length > 1 && venueName) {
          match = dateMatches.find((p) =>
            norm(p.venue?.name || '').includes(norm(venueName)) ||
            norm(venueName).includes(norm(p.venue?.name || ''))
          ) || dateMatches[0];
        } else if (dateMatches.length > 1) {
          match = dateMatches[0];
        }

        // Close date fallback
        if (!match && eventDate) {
          const targetTime = new Date(eventDate).getTime();
          match = productions.find((p) => {
            const pDate = new Date(p.utcDate || p.localDate);
            return Math.abs(pDate.getTime() - targetTime) < 36 * 60 * 60 * 1000;
          });
        }
      }

      if (match) {
        form.actions.updateField('mapping_id', String(match.id));
      } else {
        form.actions.setError(
          targetDate
            ? `Found ${productions.length} events but none match date ${targetDate}`
            : `Found ${productions.length} events — enter Event Date to auto-match`
        );
      }
    } catch (err) {
      form.actions.setError('Vivid ID fetch failed: Network error');
    } finally {
      setFetchingVividId(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!form.actions.validate()) {
      form.actions.setError("Please fill in all required fields correctly");
      return;
    }

    form.actions.setFormState('submitting');
    form.actions.setError("");

    try {
      const eventData = {
        URL: form.data.URL.value,
        Event_ID: form.data.Event_ID.value,
        Event_Name: form.data.Event_Name.value,
        Event_DateTime: form.data.Event_DateTime.value,
        Venue: form.data.Venue.value,
        Zone: form.data.Zone.value,
        Available_Seats: form.data.Available_Seats.value,
        Skip_Scraping: form.data.Skip_Scraping.value,
        inHandDate: form.data.inHandDate.value,
        mapping_id: form.data.mapping_id.value,
        priceIncreasePercentage: form.data.Percentage_Increase_ListCost.value,
        standardMarkupAdjustment: form.data.standardMarkupAdjustment.value,
        resaleMarkupAdjustment: form.data.resaleMarkupAdjustment.value,
      };

      let result;
      if (mode === 'edit' && initialData?._id) {
        // Check if price percentage has changed
        const originalPercentage = initialData.priceIncreasePercentage || 0;
        const newPercentage = form.data.Percentage_Increase_ListCost.value;
        const percentageChanged = originalPercentage !== newPercentage;
        
        result = await updateEvent(initialData._id, eventData, percentageChanged);
        
        // Log seat deletion if percentage changed
        if (percentageChanged && result.deletedSeatGroups > 0) {
          console.log(`Price percentage updated. Deleted ${result.deletedSeatGroups} seat groups.`);
        }
      } else {
        result = await createEvent(eventData);
      }

      if (result.error) {
        throw new Error(result.error);
      }

      form.actions.setFormState('success');
      notifications.actions.showNotification('success', 
        mode === 'edit' ? "Event updated successfully!" : "Event created successfully!"
      );

      // Clear form and reset states
      setTimeout(() => {
        onSuccess?.(result);
      }, 1500);
    } catch (err) {
      form.actions.setError(err.message || "An unexpected error occurred");
      form.actions.setFormState('error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header using explicit mode variants */}
      {mode === 'create' ? (
        <EventFormMode.Create.Header onCancel={onCancel} />
      ) : (
        <EventFormMode.Edit.Header onCancel={onCancel} />
      )}

      {/* Main Form Card */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        {/* Status Messages using explicit variants */}
        {form.error && <FormStatusMessages.Error message={form.error} />}
        {form.state === 'success' && (
          <FormStatusMessages.Success 
            message={mode === 'edit' ? "Event updated successfully!" : "Event created successfully!"} 
          />
        )}

        {/* Form using compound components */}
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* URL Field */}
            <div className="md:col-span-2">
              <EventFormFields.URL
                name="URL"
                value={form.data.URL.value}
                status={form.data.URL.status}
                error={form.data.URL.error}
                onChange={handleInputChange}
                onBlur={handleBlur}
                disabled={form.meta.isSubmitting}
              />
            </div>

            {/* Event ID Field */}
            <EventFormFields.EventID
              name="Event_ID"
              value={form.data.Event_ID.value}
              status={form.data.Event_ID.status}
              error={form.data.Event_ID.error}
              onChange={handleInputChange}
              onBlur={handleBlur}
              disabled={form.meta.isSubmitting}
            />

            {/* Event Name Field */}
            <EventFormFields.EventName
              name="Event_Name"
              value={form.data.Event_Name.value}
              status={form.data.Event_Name.status}
              error={form.data.Event_Name.error}
              onChange={handleInputChange}
              onBlur={handleBlur}
              disabled={form.meta.isSubmitting}
            />

            {/* Event Date/Time Field */}
            <EventFormFields.DateTime
              name="Event_DateTime"
              value={form.data.Event_DateTime.value}
              status={form.data.Event_DateTime.status}
              error={form.data.Event_DateTime.error}
              onChange={handleInputChange}
              onBlur={handleBlur}
              disabled={form.meta.isSubmitting}
            />

            {/* In-Hand Date Field */}
            <EventFormFields.InHandDate
              name="inHandDate"
              value={form.data.inHandDate.value}
              status={form.data.inHandDate.status}
              error={form.data.inHandDate.error}
              onChange={handleInputChange}
              onBlur={handleBlur}
              disabled={form.meta.isSubmitting}
            />

            {/* Venue Field */}
            <EventFormFields.Venue
              name="Venue"
              value={form.data.Venue.value}
              status={form.data.Venue.status}
              error={form.data.Venue.error}
              onChange={handleInputChange}
              onBlur={handleBlur}
              disabled={form.meta.isSubmitting}
            />

            {/* Zone Field */}
            <EventFormFields.Zone
              name="Zone"
              value={form.data.Zone.value}
              status={form.data.Zone.status}
              error={form.data.Zone.error}
              onChange={handleInputChange}
              onBlur={handleBlur}
              disabled={form.meta.isSubmitting}
            />

            {/* Available Seats Field */}
            <EventFormFields.AvailableSeats
              name="Available_Seats"
              value={form.data.Available_Seats.value}
              onChange={handleInputChange}
              disabled={form.meta.isSubmitting}
            />

            {/* Skip Scraping Field */}
            <EventFormFields.SkipScraping
              name="Skip_Scraping"
              checked={form.data.Skip_Scraping.value}
              onChange={handleCheckboxChange}
              disabled={form.meta.isSubmitting}
            />

            {/* Event Mapping ID Field + Fetch Button */}
            <div>
              <EventFormFields.MappingID
                name="mapping_id"
                value={form.data.mapping_id.value}
                status={form.data.mapping_id.status}
                error={form.data.mapping_id.error}
                onChange={handleInputChange}
                onBlur={handleBlur}
                disabled={form.meta.isSubmitting}
              />
              <button
                type="button"
                onClick={handleFetchVividId}
                disabled={form.meta.isSubmitting || fetchingVividId}
                className="mt-1.5 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Auto-fetch Vivid Seats mapping ID from event name"
              >
                {fetchingVividId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                {fetchingVividId ? 'Fetching...' : 'Fetch Vivid ID'}
              </button>
            </div>

            {/* Price Increase Field */}
            <EventFormFields.PriceIncrease
              name="Percentage_Increase_ListCost"
              value={form.data.Percentage_Increase_ListCost.value}
              status={form.data.Percentage_Increase_ListCost.status}
              error={form.data.Percentage_Increase_ListCost.error}
              onChange={handleInputChange}
              onBlur={handleBlur}
              disabled={form.meta.isSubmitting}
            />

            {/* Standard / Resale markup adjustment */}
            <EventFormFields.MarkupAdjustments
              standardAdj={Number(form.data.standardMarkupAdjustment.value)}
              resaleAdj={Number(form.data.resaleMarkupAdjustment.value)}
              defaultPct={Number(form.data.Percentage_Increase_ListCost.value)}
              onStandardChange={val => form.actions.updateField('standardMarkupAdjustment', val)}
              onResaleChange={val => form.actions.updateField('resaleMarkupAdjustment', val)}
              disabled={form.meta.isSubmitting}
            />
          </div>

          {/* Submit buttons using explicit mode variants */}
          {mode === 'create' ? (
            <EventFormMode.Create.SubmitButton 
              state={form.state}
              onCancel={onCancel} 
            />
          ) : (
            <EventFormMode.Edit.SubmitButton 
              state={form.state}
              onCancel={onCancel} 
            />
          )}
        </form>
      </div>
    </div>
  );
};

// Export wrapper components with explicit mode variants
const NewScraper = ({ onCancel, onSuccess, initialData = null, isEdit = false }) => {
  // Maintain backward compatibility while transitioning to explicit variants
  if (isEdit) {
    return (
      <EditEventForm 
        onCancel={onCancel}
        onSuccess={onSuccess}
        initialData={initialData}
      />
    );
  } else {
    return (
      <CreateEventForm 
        onCancel={onCancel}
        onSuccess={onSuccess}
      />
    );
  }
};

export default NewScraper;
export { CreateEventForm, EditEventForm };
