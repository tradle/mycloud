Below is a description of how we dump data to the data lake.
This is implemented in the job athenafeed.ts

## Introduction 
Any write into dynamoDB is duplicated by creating an object in S3. 
When object is modified in DynamoDB, a new S3 object is created, thus previous object versions are always preserved as separate S3 objects. The object's bucket name follows the pattern "tdl-....-ltd-dev-buckets-...-objects-..."
Note that the DynamoDB record often does not have all properties of the object due to DynamoDB record size limitations.
   
The function of the athenafeed job is to detect new S3 objects in the **objects** bucket and
merge them into the file in the data lake. Objects of the same type (same data model) are placed into a separate data lake file. New objects are appended and existing objects updated in this type-specific file. The data lake files are saved to S3 bucket with the following name pattern
     "tdl-...-ltd-dev-buckets-...-privateconf-..." in data_export/ folder.    

## Algorithm
   The run time of the job is limited by Lambda hard time limit of 15 minutes.
   So at every job invocation for  ~ 10 minutes it does the following:
    - collects into memory all file names found in objects bucket
    - sort them by file timestamp
    - maintains marker file with the name of last processed object
    - starting from file following the marker reads objects into memory to discover
      an object type and permalink.
    - opens write file stream into local /tmp for every type encountered and appends
      the object content as a string line
    - when the time limit is reached closes the file streams

   After that, the job starts downloading from S3 the previously exported files that
    need to be appended/updated (rember that each file corresponds for a type, like Form, Application).
    - two files per type are maintained:
      one contains the aggregated objects json lines,
      the other is like an index, it has an array of all permalinks of objects in the first file. This index is used to speed up the update.
    - the previously exported objects file is downloaded and merged with a file
 of the same type found in /temp, and the result is uploaded back to S3 as a replacement.
      Then index file is updated and uploaded to S3, replacing prior version of this file.
    - marker file refreshed to contain the name of the last object processed in objects bucket.

   Creates Athena tables, one per exported data type if not yet exists.
