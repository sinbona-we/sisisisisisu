/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { GoogleGenAI } from "@google/genai";
import { fetchLiveWeatherData, formatOpenMeteoData, OpenMeteoParams } from "./weatherService";

// Initialize Gemini
// @ts-ignore
const apiKey = import.meta.env?.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || "";
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

export interface DashboardWidget {
  id: string;
  type: "line" | "bar" | "area" | "pie" | "kpi" | "text" | "scatter" | "3d" | "composed" | "radar" | "weather";
  title: string;
  description?: string;
  dataSource: "weather";
  customData?: any[];
  xAxisKey?: string;
  dataKeys?: string[];
  seriesKey?: string;
  aggregate?: "sum" | "avg" | "max" | "min";
  value?: string | number;
  trend?: number;
  xLabel?: string;
  yLabel?: string;
  unit?: string;
}

export interface DashboardResponse {
  analysis: string;
  widgets: DashboardWidget[];
  layout: "grid" | "single" | "compare";
  apiParams: OpenMeteoParams | OpenMeteoParams[]; // The API parameters used to fetch data for the widgets
  resolvedCity?: string | null;
  resolvedDate?: string | null;
}

const apiSystemPrompt = `
You are an API parameter generator for Open-Meteo.
Your goal is to analyze the user's natural language query and generate a JSON object containing the exact API parameters needed to answer the user's question.

PARAMETERS REQUIRED:
- "latitude": number (e.g. 40.71)
- "longitude": number (e.g. -74.00)
- "city": string (e.g. "New York")
- "start_date": string (optional, format YYYY-MM-DD). If the user asks for historical data or a specific timeframe, calculate this based on the Current Date.
- "end_date": string (optional, format YYYY-MM-DD). Must be provided if start_date is provided.
- "daily": array of string variables (optional). Available variables: weather_code, temperature_2m_max, temperature_2m_min, apparent_temperature_max, apparent_temperature_min, sunrise, sunset, daylight_duration, sunshine_duration, uv_index_max, uv_index_clear_sky_max, precipitation_sum, rain_sum, showers_sum, snowfall_sum, precipitation_hours, precipitation_probability_max, wind_speed_10m_max, wind_gusts_10m_max, wind_direction_10m_dominant, shortwave_radiation_sum, et0_fao_evapotranspiration
- "hourly": array of string variables (optional). Available variables: temperature_2m, relative_humidity_2m, dew_point_2m, apparent_temperature, precipitation_probability, precipitation, rain, showers, snowfall, snow_depth, weather_code, pressure_msl, surface_pressure, cloud_cover, cloud_cover_low, cloud_cover_mid, cloud_cover_high, visibility, evapotranspiration, et0_fao_evapotranspiration, vapor_pressure_deficit, wind_speed_10m, wind_speed_80m, wind_speed_120m, wind_speed_180m, wind_direction_10m, wind_direction_80m, wind_direction_120m, wind_direction_180m, wind_gusts_10m, temperature_80m, temperature_120m, temperature_180m, soil_temperature_0cm, soil_temperature_6cm, soil_temperature_18cm, soil_temperature_54cm, soil_moisture_0_to_1cm, soil_moisture_1_to_3cm, soil_moisture_3_to_9cm, soil_moisture_9_to_27cm, soil_moisture_27_to_81cm

RULES:
- Respond with a JSON object ONLY containing the parameters above. If the user asks to compare multiple cities, respond with an array of JSON objects, one for each city.
- IMPORTANT: Provide either "daily" or "hourly" depending on what best answers the user's question, but try not to provide both unless absolutely necessary, to keep the data simple. Usually daily is best for general trends over days, and hourly is best for specific day details.
- CRITICAL: Do NOT mix hourly variables into the "daily" array, or daily variables into the "hourly" array. Only use the exact strings listed for each category. If you need both, return both a "daily" array and an "hourly" array.
- Use your internal knowledge to resolve the city name to latitude and longitude.
- Prefer returning an array of relevant variables if the user asks for general weather.
`;

const layoutSystemPrompt = `
You are a Dynamic UI Orchestrator for a weather dashboard.
Your goal is to analyze the user's natural language query AND the provided data results from the API, then generate a JSON configuration to render the most appropriate visualization.
You should make decisions on what widgets to show based on the actual data returned.

INSTRUCTIONS:

Construct a JSON response with:
   - "analysis": A brief, user-facing insight or summary based on the provided data results. It MUST be written as an observation about the weather itself, not an explanation of what widget you chose or what UI you are building. Tell them an interesting fact about their data. Example: "New York experienced a significant drop in temperature over the weekend, bottoming out at -5°C." Do NOT say things like "A KPI widget is best" or "I have chosen to show a bar chart."
   - "resolvedCity": The name of the city the data primarily belongs to. Infer this from the User Query or the provided API parameters. If the query applies to multiple cities or no specific city, leave it as null.
   - "resolvedDate": If the user's query or the analysis highlights a specific date or date range (e.g., "February 26, 2026", "Feb 14-20"), provide it here as a short string. Otherwise, leave it as null.
   - "layout": Recommended layout ("grid", "single", "compare").
   - "widgets": An array of UI components to render.

WIDGET TYPES AND THEIR ARGUMENTS (Properties to include in the widget JSON object):

1. Chart Widgets ("line", "bar", "area", "scatter", "pie", "composed", "radar"):
   - "type": One of "line", "bar", "area", "scatter", "pie", "composed", "radar".
     - "composed": Great for mixing bar and line charts (e.g. temperature as line, precipitation as bar). CRITICAL: DO NOT use "composed" charts if "seriesKey" is provided (comparing multiple cities). Use "line" or "bar" instead.
     - "radar": Great for comparing multiple attributes of a single day or city (e.g. wind speed vs humidity vs cloud cover).
   - "title" (string): The title of the chart.
   - "description" (string, optional): Subtitle or context for the chart.
   - "xAxisKey" (string): The column name from the data to use for the X-axis (usually "date" or "city").
   - "dataKeys" (string[]): Array of column names from the data to plot. For pie charts, the first key is used for values. For composed charts, provide up to 2 keys.
   - "seriesKey" (string, optional): If the data contains multiple entities (like different cities), provide the column name to group by (e.g., "city"). This tells the chart to draw a separate line/bar for each entity. Do not use this for "pie" or "kpi".
   - "xLabel" (string, optional): Label for the X-axis (required for "scatter").
   - "yLabel" (string, optional): Label for the Y-axis (required for "scatter").

2. KPI Widget ("kpi"):
   - "type": "kpi"
   - "title" (string): The title of the metric.
   - "description" (string, optional): Additional context or subtitle.
   - "dataKeys" (string[]): Array with exactly one column name representing the metric to display.
   - "aggregate" (string, optional): One of "sum", "avg", "max", or "min". If you are returning time-series data (multiple rows) but want this KPI to show the total or average across all those rows, specify this field. The frontend will calculate the math for you.
   - "unit" (string, optional): The unit of measurement (e.g., "°C", "mm", "%").
   - "trend" (number, optional): A percentage change value to display a trend indicator (e.g., 5.2 or -1.5).
   - If dataKeys includes snow_depth, the "unit" MUST be "m".
   - If dataKeys includes snowfall, the "unit" MUST be "cm".
   - CRITICAL: DO NOT use "kpi" widgets if the user query compares multiple cities. KPI widgets currently merge all data points, which creates misleading blended averages. If comparing cities, use ONLY charts.

3. 3D Visualization Widget ("3d"):
   - "type": "3d"
   - "title" (string): The title of the 3D visualization.
   - "description" (string, optional): Additional context or subtitle.
   - "xAxisKey" (string): The column name to use for the 3D bar labels (usually "date").
   - "dataKeys" (string[]): Array with at least one column name. The first column is used to determine the height and color of the 3D bars.

4. Weather Card Widget ("weather"):
   - "type": "weather"
   - "title" (string): The title (e.g., "Current Weather").
   - "description" (string, optional): Additional context or subtitle.
   - "dataKeys" (string[]): Can be empty or contain any relevant columns.
   *USE THIS TYPE if the user is asking for a general weather overview, current weather conditions, or a summary for a specific city. NOTE: A weather card automatically consumes and displays any KPI widgets you ALSO return in this layout. If you return a weather widget, you SHOULD also return 1-5 "kpi" widgets in the same response to populate the weather card's metrics (e.g. main temperature, wind speed, humidity).*

RULES:
- "dataSource" must be "weather".
- "dataKeys" must EXACTLY correspond to the columns present in the provided data. This is CRITICAL for data mapping.
- "xAxisKey" must be "date" or another relevant column from the data.
- NEVER talk about UI components, widgets, charts, or layouts in the "analysis" field. The analysis must ONLY be an insight about the weather data itself.
- CRITICAL: When writing the "analysis" and assigning "unit" to widgets, Temperatures are in °C. Rain/Precipitation is in mm. Snowfall is in cm. Wind speed is in km/h. Do not hallucinate other units.
- IMPORTANT: If the user asks about "snowfall" or snow, add a caveat to the analysis field explaining that the data represents modeled liquid water equivalent, not manual ruler-on-the-ground measurements, which is why it may differ from local news reports.
- Be creative!
- Use stable IDs for widgets.
- If the data is empty, mention that in the analysis and perhaps show fewer or different widgets.

RESPONSE FORMAT:
Return ONLY valid JSON.
`;

export async function generateDashboardConfig(query: string): Promise<DashboardResponse> {
  if (!ai) {
    throw new Error("No API key found. AI features are unavailable.");
  }

  try {
    const baseContext = `
      User Query: "${query}"
      Current Date: ${new Date().toISOString().split('T')[0]}
    `;

    // Part 1: Generate API Parameters
    const paramsResponse = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite-preview", 
      contents: [
        { role: "user", parts: [{ text: apiSystemPrompt + "\n" + baseContext }] }
      ],
      config: {
        responseMimeType: "application/json",
      }
    });
    
    const paramsResponseText = (typeof (paramsResponse as any).text === 'function') ? (paramsResponse as any).text() : (paramsResponse as any).text;
    if (!paramsResponseText) throw new Error("No response from AI for API parameter generation");
    
    const parsedParams = JSON.parse(paramsResponseText);
    const paramsArray: OpenMeteoParams[] = Array.isArray(parsedParams) ? parsedParams : [parsedParams];
    console.log("Generated API Params:", paramsArray);
    
    let queryResult: any[] = [];
    try {
      const fetchPromises = paramsArray.map(async (params) => {
        if (params.latitude && params.longitude) {
          const rawData = await fetchLiveWeatherData(params);
          return formatOpenMeteoData(rawData, params.city);
        }
        return [];
      });
      const resultsArray = await Promise.all(fetchPromises);
      queryResult = resultsArray.flat();
      console.log("API Results length:", queryResult.length);
    } catch (apiError) {
      console.error("Error fetching live weather data:", paramsArray, apiError);
    }

    // Calculate a summary of the data instead of just sending all rows
    const dataSummary: Record<string, any> = {};
    if (queryResult.length > 0) {
      const keys = Object.keys(queryResult[0]).filter(k => typeof queryResult[0][k] === 'number');
      keys.forEach(key => {
        const validRows = queryResult.filter(r => r[key] !== undefined && r[key] !== null);
        if (validRows.length > 0) {
          const vals = validRows.map(r => r[key]);
          const min = Math.min(...vals);
          const max = Math.max(...vals);
          const sum = vals.reduce((a, b) => a + b, 0);
          
          const minRow = validRows.find(r => r[key] === min);
          const maxRow = validRows.find(r => r[key] === max);

          dataSummary[key] = {
            min,
            minDate: minRow?.date || null,
            minCity: minRow?.city || null,
            max,
            maxDate: maxRow?.date || null,
            maxCity: maxRow?.city || null,
            sum: Number(sum.toFixed(2)),
            avg: Number((sum / vals.length).toFixed(2))
          };
        }
      });
    }

    const dataContext = `
      API Parameters Used: ${JSON.stringify(paramsArray)}
      
      Total rows returned: ${queryResult.length}
      
      Data Statistics (Min, Max, Sum, Avg for numeric columns):
      ${JSON.stringify(dataSummary, null, 2)}
    `;

    // Part 2: Generate Layout and Widgets
    const layoutResponse = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite-preview", 
      contents: [
        { role: "user", parts: [{ text: layoutSystemPrompt + "\n" + baseContext + "\n" + dataContext }] }
      ],
      config: {
        responseMimeType: "application/json",
      }
    });

    const layoutResponseText = (typeof (layoutResponse as any).text === 'function') ? (layoutResponse as any).text() : (layoutResponse as any).text;
    if (!layoutResponseText) throw new Error("No response from AI for layout generation");

    const parsedLayoutResponse = JSON.parse(layoutResponseText) as DashboardResponse;
    console.log("Layout response:", JSON.stringify(parsedLayoutResponse, null, 2));
    parsedLayoutResponse.apiParams = paramsArray;

    // Inject the query data into each widget
    parsedLayoutResponse.widgets = parsedLayoutResponse.widgets.map(widget => {
      let value = widget.value;
      if (widget.type === 'kpi' && widget.dataKeys && widget.dataKeys.length > 0 && queryResult.length > 0) {
        const key = widget.dataKeys[0];
        if (widget.aggregate) {
          const values = queryResult.map(row => Number(row[key])).filter(n => !isNaN(n));
          if (values.length > 0) {
            if (widget.aggregate === "sum") value = values.reduce((a, b) => a + b, 0);
            else if (widget.aggregate === "avg") value = values.reduce((a, b) => a + b, 0) / values.length;
            else if (widget.aggregate === "max") value = Math.max(...values);
            else if (widget.aggregate === "min") value = Math.min(...values);
          }
        } else {
          // Compute value from the first row of queried data for the requested dataKey
          value = queryResult[0][key] as any;
        }
      }

      return {
        ...widget,
        value,
        customData: queryResult
      };
    });

    // Also generate a quick insight if analysis is generic
    if (!parsedLayoutResponse.analysis || parsedLayoutResponse.analysis.length < 10) {
       parsedLayoutResponse.analysis = `Found ${queryResult.length} records matching your query.`;
    }
    
    // Fallback to infer resolvedCity from the query results if AI didn't provide one
    if (!parsedLayoutResponse.resolvedCity && queryResult.length > 0 && queryResult[0].city) {
      parsedLayoutResponse.resolvedCity = queryResult[0].city;
    }

    return parsedLayoutResponse;

  } catch (error) {
    console.error("Error generating dashboard with AI:", error);
    throw error;
  }
}
